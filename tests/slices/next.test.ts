import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Command } from 'commander'
import '../../src/engine/default-deps.js'
import { registerNextCommand } from '../../src/slices/next/index.js'
import { initTmpDir, cleanupTmpDir } from '../helpers/setup.js'
import { initRun, setDefaultEngineDeps } from '../../src/domain/engine/execution-engine.js'
import { setCurrentRunId } from '../../src/domain/run/run-resolver.js'
import type { CompiledGraph, Task } from '../../src/shared/models/compiled-graph.js'

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
  registerNextCommand(program)
  return program
}

// ── Helper: Build CompiledGraph for testing ──────────────────────────

/**
 * Build a minimal CompiledGraph for testing.
 * Creates nodes that return simple patches, with trigger/barrier channels
 * derived from edges.
 */
function buildTestGraph(
  nodeNames: string[],
  edges: Array<{ from: string; to: string }>,
  graphName = 'next-test-graph',
  stateSchema: Record<string, unknown> = {},
): CompiledGraph {
  // Build target → sources map from edges
  const targetToSources = new Map<string, string[]>()
  for (const edge of edges) {
    const sources = targetToSources.get(edge.to) ?? []
    sources.push(edge.from)
    targetToSources.set(edge.to, sources)
  }

  // Build channels and per-node metadata
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
      fn: (_state: Record<string, unknown>) => ({ [name]: `done-${name}` }),
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

/** Simple topological layer computation (Kahn's algorithm) */
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

// ── Helper: Set up a running workflow ────────────────────────────────

/**
 * Set up a run with a compiled graph, make it the active run, and return the runId.
 * Layer 0 tasks are created as 'ready' by initRun.
 */
async function setupRunningWorkflow(
  nodeNames: string[],
  edges: Array<{ from: string; to: string }> = [],
  graphName = 'next-test-graph',
  stateSchema: Record<string, unknown> = {},
): Promise<string> {
  const graph = buildTestGraph(nodeNames, edges, graphName, stateSchema)
  const runId = `${graphName}@${Date.now().toString(36)}`

  // Mock compileWorkflow so executeStep can recompile
  setDefaultEngineDeps({
    compileWorkflow: async (name: string) => {
      if (name === graphName) return graph
      throw new Error(`unknown graph '${name}'`)
    },
  })

  await initRun(runId, graph)
  await setCurrentRunId(runId)

  return runId
}

// ===== Positive (happy path) tests =====

describe('next command — positive cases', () => {
  it('should execute a single ready task', async () => {
    await setupRunningWorkflow(['alpha'])

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next'])

    expect(exitSpy).not.toHaveBeenCalled()

    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    // The new command displays "N node(s) executed" and "nodeId → status"
    expect(calls.some((line: string) => line.includes('1 node(s) executed'))).toBe(true)
    expect(calls.some((line: string) => line.includes('alpha'))).toBe(true)
    expect(calls.some((line: string) => line.includes('success'))).toBe(true)
  })

  it('should output JSON with --json flag after executing a task', async () => {
    await setupRunningWorkflow(['beta'])

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--json'])

    expect(exitSpy).not.toHaveBeenCalled()

    const jsonOutput = logSpy.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(jsonOutput)
    expect(parsed.executed).toBeDefined()
    expect(parsed.executed).toContain('beta')
    expect(parsed.completed).toBe(true) // single node graph completes after execution
    expect(parsed.step).toBeDefined()
    expect(parsed.status).toBeDefined()
    expect(parsed.tasks).toBeDefined()
  })

  it('should execute all tasks in layer 0 with --all flag', async () => {
    await setupRunningWorkflow(['alpha', 'bravo', 'charlie'])

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--all'])

    expect(exitSpy).not.toHaveBeenCalled()

    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    expect(calls.some((line: string) => line.includes('3 node(s) executed'))).toBe(true)
    expect(calls.some((line: string) => line.includes('alpha'))).toBe(true)
    expect(calls.some((line: string) => line.includes('bravo'))).toBe(true)
    expect(calls.some((line: string) => line.includes('charlie'))).toBe(true)
  })

  it('should output JSON array with --all --json after executing tasks', async () => {
    await setupRunningWorkflow(['alpha', 'bravo'])

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--all', '--json'])

    expect(exitSpy).not.toHaveBeenCalled()

    const jsonOutput = logSpy.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(jsonOutput)
    expect(parsed.executed).toBeDefined()
    const executed = parsed.executed as string[]
    expect(executed.sort()).toEqual(['alpha', 'bravo'])
    expect(parsed.completed).toBe(true)
  })

  it('should show current step info with --step flag', async () => {
    await setupRunningWorkflow(['alpha'])

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--step'])

    expect(exitSpy).not.toHaveBeenCalled()

    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    // --step displays "Step N/M — status: running" and task list
    expect(calls.some((line: string) => line.includes('status: running'))).toBe(true)
    expect(calls.some((line: string) => line.includes('alpha'))).toBe(true)
  })

  it('should show step info as JSON with --step --json', async () => {
    await setupRunningWorkflow(['alpha'])

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--step', '--json'])

    expect(exitSpy).not.toHaveBeenCalled()

    const jsonOutput = logSpy.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(jsonOutput)
    expect(parsed.step).toBe(0)
    expect(parsed.status).toBe('running')
    expect(parsed.tasks).toBeDefined()
    const taskNames = (parsed.tasks as Task[]).map((t) => t.nodeId)
    expect(taskNames).toContain('alpha')
  })

  it('should select explicit run with --run option', async () => {
    // Set up two graphs with their compileWorkflow mock
    const graph1 = buildTestGraph(['gamma'], [], 'explicit-run-graph')
    const runId = `${'explicit-run-graph'}@${Date.now().toString(36)}`

    const graph2 = buildTestGraph(['delta'], [], 'other-run-graph')
    const runId2 = `${'other-run-graph'}@${Date.now().toString(36)}`

    setDefaultEngineDeps({
      compileWorkflow: async (name: string) => {
        if (name === 'explicit-run-graph') return graph1
        if (name === 'other-run-graph') return graph2
        throw new Error(`unknown graph '${name}'`)
      },
    })

    await initRun(runId, graph1)
    await initRun(runId2, graph2)
    await setCurrentRunId(runId2) // second run is the "current" one

    // Use --run to target the first run explicitly
    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--run', runId])

    expect(exitSpy).not.toHaveBeenCalled()

    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    expect(calls.some((line: string) => line.includes('gamma'))).toBe(true)
    expect(calls.some((line: string) => line.includes('delta'))).toBe(false)
  })
})

// ===== Negative (error/edge case) tests =====

describe('next command — negative cases', () => {
  it('should show "No active run found" when no run exists', async () => {
    // No workflow setup — no runs exist at all
    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next'])

    expect(exitSpy).toHaveBeenCalledWith(1)
    const errMsg = errSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join(' ')
    expect(errMsg).toContain('No active run found')
  })

  it('should show error for nonexistent run ID with --run', async () => {
    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--run', 'nonexistent@00000000'])

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('should show "completed" message when all tasks are already done', async () => {
    // Setup single-node graph and execute it (which completes the run)
    await setupRunningWorkflow(['alpha'])

    // First next: executes and completes
    const program1 = createProgram()
    await program1.parseAsync(['node', 'dagman', 'next'])
    expect(exitSpy).not.toHaveBeenCalled()

    // Reset spies before second call
    logSpy.mockClear()
    errSpy.mockClear()
    exitSpy.mockClear()

    // Second next: run is completed
    const program2 = createProgram()
    await program2.parseAsync(['node', 'dagman', 'next'])

    expect(exitSpy).not.toHaveBeenCalled()
    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    expect(
      calls.some(
        (line: string) => line.includes('Run completed') || line.includes('no more steps'),
      ),
    ).toBe(true)
  })

  it('should return completed JSON with --all --json when run is completed', async () => {
    await setupRunningWorkflow(['alpha'])

    // Execute the single step
    const program1 = createProgram()
    await program1.parseAsync(['node', 'dagman', 'next'])

    // Reset spies
    logSpy.mockClear()
    errSpy.mockClear()
    exitSpy.mockClear()

    // Try again with --all --json
    const program2 = createProgram()
    await program2.parseAsync(['node', 'dagman', 'next', '--all', '--json'])

    expect(exitSpy).not.toHaveBeenCalled()
    const jsonOutput = logSpy.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(jsonOutput)
    expect(parsed.executed).toEqual([])
    expect(parsed.completed).toBe(true)
  })

  it('should show "completed" message with --all when run is completed', async () => {
    await setupRunningWorkflow(['alpha'])

    // Execute the single step
    const program1 = createProgram()
    await program1.parseAsync(['node', 'dagman', 'next'])

    // Reset spies
    logSpy.mockClear()
    errSpy.mockClear()
    exitSpy.mockClear()

    // Try again with --all
    const program2 = createProgram()
    await program2.parseAsync(['node', 'dagman', 'next', '--all'])

    expect(exitSpy).not.toHaveBeenCalled()
    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    expect(
      calls.some(
        (line: string) => line.includes('Run completed') || line.includes('no more steps'),
      ),
    ).toBe(true)
  })
})
