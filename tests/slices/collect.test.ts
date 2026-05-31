import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as path from 'path'
import * as fs from 'fs/promises'
import { Command } from 'commander'
import '../../src/engine/default-deps.js'
import { registerCollectCommand } from '../../src/slices/collect/index.js'
import { initTmpDir, cleanupTmpDir } from '../helpers/setup.js'
import { initRun } from '../../src/domain/engine/execution-engine.js'
import { readState } from '../../src/domain/engine/state-service.js'
import { setCurrentRunId } from '../../src/domain/run/run-resolver.js'
import type { CompiledGraph } from '../../src/shared/models/compiled-graph.js'

let logSpy: ReturnType<typeof vi.spyOn>
let errSpy: ReturnType<typeof vi.spyOn>
let exitSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  initTmpDir()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)
})

afterEach(async () => {
  logSpy.mockRestore()
  errSpy.mockRestore()
  exitSpy.mockRestore()
  await cleanupTmpDir()
})

function createProgram(): Command {
  const program = new Command()
  program.exitOverride()
  program.configureOutput({ writeErr: () => {} })
  registerCollectCommand(program)
  return program
}

/**
 * Build a minimal CompiledGraph for testing.
 * Creates nodes that return empty patches, with trigger channels
 * for downstream dependencies.
 */
function buildTestGraph(
  nodeNames: string[],
  edges: Array<{ from: string; to: string }>,
  graphName = 'test-graph',
  stateSchema: Record<string, unknown> = {},
): CompiledGraph {
  const noOp = (_state: Record<string, unknown>) => ({}) as Record<string, unknown>

  // Build target → sources map from edges
  const targetToSources = new Map<string, string[]>()
  for (const edge of edges) {
    const sources = targetToSources.get(edge.to) ?? []
    sources.push(edge.from)
    targetToSources.set(edge.to, sources)
  }

  // Build channels and collect per-node data
  const channels: CompiledGraph['channels'] = {}
  const nodeStrategies: Record<string, Array<{ type: 'direct'; channel: string }>> = {}
  const nodeTrigger: Record<string, string> = {}

  for (const name of nodeNames) {
    nodeStrategies[name] = []
  }

  for (const [target, sources] of targetToSources) {
    if (sources.length === 1) {
      const channelName = `trigger:${target}`
      channels[channelName] = { name: channelName, type: 'trigger' }
      nodeTrigger[target] = channelName
      nodeStrategies[sources[0]!]!.push({ type: 'direct', channel: channelName })
    } else {
      const channelName = `barrier:${target}`
      channels[channelName] = { name: channelName, type: 'barrier', writers: sources }
      nodeTrigger[target] = channelName
      for (const source of sources) {
        nodeStrategies[source]!.push({ type: 'direct', channel: channelName })
      }
    }
  }

  // Build final nodes with correct triggeredBy
  const nodes: Record<string, CompiledGraph['nodes'][string]> = {}
  for (const name of nodeNames) {
    nodes[name] = {
      id: name,
      fn: noOp,
      strategies: nodeStrategies[name] ?? [],
      triggeredBy: nodeTrigger[name] ?? `entry:${name}`,
    }
  }

  const layers = computeSimpleLayers(nodeNames, edges)

  return {
    name: graphName,
    nodes,
    stateSchema,
    channels,
    layers,
  }
}

/** Simple topological layer computation */
function computeSimpleLayers(
  nodeNames: string[],
  edges: Array<{ from: string; to: string }>,
): string[][] {
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const name of nodeNames) {
    inDegree.set(name, 0)
  }

  for (const edge of edges) {
    // from depends on to → to executes before from
    inDegree.set(edge.from, (inDegree.get(edge.from) ?? 0) + 1)
    const list = dependents.get(edge.to) ?? []
    list.push(edge.from)
    dependents.set(edge.to, list)
  }

  const layers: string[][] = []
  const assigned = new Set<string>()
  let currentLayer = [...inDegree.entries()].filter(([, deg]) => deg === 0).map(([name]) => name)

  while (currentLayer.length > 0) {
    layers.push(currentLayer)
    for (const name of currentLayer) assigned.add(name)
    const nextLayer: string[] = []
    for (const name of currentLayer) {
      for (const dep of dependents.get(name) ?? []) {
        if (assigned.has(dep)) continue
        const newDeg = inDegree.get(dep)! - 1
        inDegree.set(dep, newDeg)
        if (newDeg === 0 && !assigned.has(dep)) {
          nextLayer.push(dep)
        }
      }
    }
    currentLayer = nextLayer
  }

  return layers
}

/**
 * Set up a run with a compiled graph and return context for testing collect.
 */
async function setupCollectScenario(
  nodeNames: string[] = ['mynode'],
  edges: Array<{ from: string; to: string }> = [],
  graphName = 'collect-test',
  stateSchema: Record<string, unknown> = {},
): Promise<{ runId: string; suffix: string }> {
  const graph = buildTestGraph(nodeNames, edges, graphName, stateSchema)
  const runId = `${graphName}@deadbeef`
  await initRun(runId, graph)
  await setCurrentRunId(runId)

  // Install mock compileWorkflow for the engine deps
  // Since completeNodeExternal calls compileWorkflow, we need to make it return our graph
  // The compiler deps are already set by installMockLoadGraph in old tests,
  // but we need to ensure compile() works for our graph.
  // Simplest approach: set the engine's compileWorkflow to return our graph.
  const { setDefaultEngineDeps } = await import('../../src/domain/engine/execution-engine.js')
  setDefaultEngineDeps({
    compileWorkflow: async (name: string) => {
      if (name === graphName) return graph
      throw new Error(`unknown graph '${name}'`)
    },
  })

  const suffix = 'deadbeef'
  return { runId, suffix }
}

// ===== Positive (happy path) tests =====

describe('collect command — positive cases', () => {
  it('should collect with --value option and complete the task', async () => {
    const { runId, suffix } = await setupCollectScenario(['mynode'], [], 'val-test')

    const program = createProgram()
    await program.parseAsync([
      'node',
      'dagman',
      'collect',
      `mynode@${suffix}`,
      '--value',
      '{"result":"done"}',
    ])

    expect(exitSpy).not.toHaveBeenCalled()

    // Verify state was updated
    const state = await readState(runId)
    expect(state.mynode).toEqual({ result: 'done' })

    // Verify console output
    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    expect(calls.some((line: string) => line.includes("Collected 'mynode'"))).toBe(true)
    expect(calls.some((line: string) => line.includes('success'))).toBe(true)
  })

  it('should collect with --file option and complete the task', async () => {
    const { runId, suffix } = await setupCollectScenario(['process'], [], 'file-test')

    // Write a JSON result file
    const resultPath = path.join(process.cwd(), 'result.json')
    await fs.writeFile(resultPath, JSON.stringify({ output: 'processed' }))

    const program = createProgram()
    await program.parseAsync([
      'node',
      'dagman',
      'collect',
      `process@${suffix}`,
      '--file',
      resultPath,
    ])

    expect(exitSpy).not.toHaveBeenCalled()

    const state = await readState(runId)
    expect(state.process).toEqual({ output: 'processed' })

    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    expect(calls.some((line: string) => line.includes("Collected 'process'"))).toBe(true)
  })

  it('should output JSON with --json flag', async () => {
    const { suffix } = await setupCollectScenario(['analyze'], [], 'json-test')

    const program = createProgram()
    await program.parseAsync([
      'node',
      'dagman',
      'collect',
      `analyze@${suffix}`,
      '--value',
      '{"type":"report"}',
      '--json',
    ])

    expect(exitSpy).not.toHaveBeenCalled()

    const jsonOutput = logSpy.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(jsonOutput)
    expect(parsed.nodeName).toBe('analyze')
    expect(parsed.stateKey).toBe('analyze')
    expect(parsed.value).toEqual({ type: 'report' })
    expect(parsed.status).toBe('success')
  })

  it('should use --key to override the default state key', async () => {
    const { runId, suffix } = await setupCollectScenario(['mynode'], [], 'key-test')

    const program = createProgram()
    await program.parseAsync([
      'node',
      'dagman',
      'collect',
      `mynode@${suffix}`,
      '--value',
      '"custom-value"',
      '--key',
      'myResult',
    ])

    expect(exitSpy).not.toHaveBeenCalled()

    const state = await readState(runId)
    expect(state.myResult).toBe('custom-value')
  })
})

// ===== Negative (error/edge case) tests =====

describe('collect command — negative cases', () => {
  it('should fail with invalid node reference format (no @ separator)', async () => {
    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'collect', 'no-at-separator', '--value', '{}'])

    expect(exitSpy).toHaveBeenCalledWith(1)
    const errMsg = errSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join(' ')
    expect(errMsg).toContain('invalid node reference')
  })

  it('should fail when instance suffix matches no run', async () => {
    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'collect', 'classify@nonexistent', '--value', '{}'])

    expect(exitSpy).toHaveBeenCalledWith(1)
    const errMsg = errSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join(' ')
    expect(errMsg).toContain('no workflow instance found')
  })

  it('should fail when neither --file nor --value is provided', async () => {
    const { suffix } = await setupCollectScenario(['mynode'], [], 'noval-test')

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'collect', `mynode@${suffix}`])

    expect(exitSpy).toHaveBeenCalledWith(1)
    const errMsg = errSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join(' ')
    expect(errMsg).toContain('must provide --file')
  })

  it('should fail when --file points to non-existent file', async () => {
    const { suffix } = await setupCollectScenario(['mynode'], [], 'nofile-test')

    const program = createProgram()
    await program.parseAsync([
      'node',
      'dagman',
      'collect',
      `mynode@${suffix}`,
      '--file',
      '/nonexistent/path/result.json',
    ])

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('should fail when --value contains invalid JSON', async () => {
    const { suffix } = await setupCollectScenario(['mynode'], [], 'badjson-test')

    const program = createProgram()
    await program.parseAsync([
      'node',
      'dagman',
      'collect',
      `mynode@${suffix}`,
      '--value',
      'not-valid-json{',
    ])

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('should fail when node is not found in compiled graph', async () => {
    const { suffix } = await setupCollectScenario(['mynode'], [], 'notfound-test')

    const program = createProgram()
    await program.parseAsync([
      'node',
      'dagman',
      'collect',
      `nonexistent@${suffix}`,
      '--value',
      '{}',
    ])

    expect(exitSpy).toHaveBeenCalledWith(1)
    const errMsg = errSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join(' ')
    expect(errMsg).toContain('not found')
  })
})
