/**
 * E2E test for `dagman next` — full A→B→C lifecycle using new compiled-graph architecture.
 *
 * Uses initRun + setDefaultEngineDeps pattern (same as collect.test.ts).
 * The `next` command now calls executeStep() which actually executes tasks and
 * advances through topological layers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Command } from 'commander'
import '../src/engine/default-deps.js'
import { registerNextCommand } from '../src/slices/next/index.js'
import { initTmpDir, cleanupTmpDir } from './helpers/setup.js'
import { initRun, setDefaultEngineDeps } from '../src/domain/engine/execution-engine.js'
import { setCurrentRunId } from '../src/domain/run/run-resolver.js'
import type { CompiledGraph } from '../src/shared/models/compiled-graph.js'

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

function createProgram(...registerFns: Array<(p: Command) => void>): Command {
  const program = new Command()
  program.exitOverride()
  program.configureOutput({ writeErr: () => {} })
  for (const fn of registerFns) fn(program)
  return program
}

function getLog(): string[] {
  return logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
}

// ── Test Helpers (same pattern as collect.test.ts) ────────────────────

/**
 * Build a minimal CompiledGraph for testing.
 * Creates nodes with no-op functions and trigger/barrier channels from edges.
 */
function buildTestGraph(
  nodeNames: string[],
  edges: Array<{ from: string; to: string }>,
  graphName = 'e2e-graph',
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

  // Build channels and per-node bindings
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

  // Build compiled nodes with triggeredBy
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

/** Simple topological layer computation (BFS / Kahn's algorithm) */
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
    // New architecture: { from, to } means "from triggers to" (flow direction)
    // So "to" depends on "from" → "to" has in-degree from "from"
    // "from" executes before "to"
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1)
    const list = dependents.get(edge.from) ?? []
    list.push(edge.to)
    dependents.set(edge.from, list)
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
 * Set up a run with a compiled graph.
 * Returns the run ID. The workflow will have ready tasks for layer 0.
 */
async function setupWorkflow(
  nodeNames: string[],
  edges: Array<{ from: string; to: string }> = [],
  graphName = 'e2e-graph',
  stateSchema: Record<string, unknown> = {},
): Promise<string> {
  const graph = buildTestGraph(nodeNames, edges, graphName, stateSchema)
  const runId = `${graphName}@deadbeef`
  await initRun(runId, graph)
  await setCurrentRunId(runId)

  // Mock compileWorkflow so executeStep can re-obtain the graph at runtime
  setDefaultEngineDeps({
    compileWorkflow: async (name: string) => {
      if (name === graphName) return graph
      throw new Error(`unknown graph '${name}'`)
    },
  })

  return runId
}

// ── Graph: A → B → C (3 layers via edges) ────────────────────────────
// In the new architecture, edge { from, to } means "from triggers to" (flow direction)
// A→B→C means A triggers B, B triggers C

const chainEdges = [
  { from: 'A', to: 'B' },
  { from: 'B', to: 'C' },
]

// ── Tests ─────────────────────────────────────────────────────────────

describe('E2E: dagman next — full A→B→C workflow (new architecture)', () => {
  it('Step 0: --step shows step 1 with status running (no tasks scheduled yet)', async () => {
    const runId = await setupWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-01')

    const prog = createProgram(registerNextCommand)
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId, '--step'])

    expect(exitSpy).not.toHaveBeenCalled()
    const out = getLog()
    expect(out.some((l) => l.includes('Step 1'))).toBe(true)
    // No tasks yet — scheduling deferred to executeStep
    expect(out.some((l) => l.includes('status: running'))).toBe(true)
  })

  it('Step 0: next executes A → shows A success', async () => {
    const runId = await setupWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-02')

    const prog = createProgram(registerNextCommand)
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId])

    expect(exitSpy).not.toHaveBeenCalled()
    const out = getLog()
    expect(out.some((l) => l.includes('A') && l.includes('success'))).toBe(true)
    expect(out.some((l) => l.includes('1 node(s) executed'))).toBe(true)
  })

  it('Step 0: next --all --json returns executed: [A]', async () => {
    const runId = await setupWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-03')

    const prog = createProgram(registerNextCommand)
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId, '--all', '--json'])

    expect(exitSpy).not.toHaveBeenCalled()
    const parsed = JSON.parse(getLog()[0]!)
    expect(parsed.executed).toEqual(['A'])
    expect(parsed.completed).toBe(false)
    expect(parsed.step).toBe(1) // advanced to layer 1 after executing A
  })

  it('Step 1: after A completes, next executes B → shows B success', async () => {
    const runId = await setupWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-04')

    // Execute step 0 (A)
    const prog1 = createProgram(registerNextCommand)
    await prog1.parseAsync(['node', 'dag', 'next', '--run', runId])

    // Execute step 1 (B)
    const prog2 = createProgram(registerNextCommand)
    await prog2.parseAsync(['node', 'dag', 'next', '--run', runId])

    expect(exitSpy).not.toHaveBeenCalled()
    const out = getLog()
    expect(out.some((l) => l.includes('B') && l.includes('success'))).toBe(true)
  })

  it('Step 1: next --step shows step 2 after A executed (B not yet scheduled)', async () => {
    const runId = await setupWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-05')

    // Execute step 0 (A) to advance to layer 1
    const prog1 = createProgram(registerNextCommand)
    await prog1.parseAsync(['node', 'dag', 'next', '--run', runId])

    // Clear log spy to inspect only the --step output
    logSpy.mockClear()

    // Check step status — B not yet scheduled (currentStepScheduled=false)
    const prog2 = createProgram(registerNextCommand)
    await prog2.parseAsync(['node', 'dag', 'next', '--run', runId, '--step'])

    expect(exitSpy).not.toHaveBeenCalled()
    const out = getLog()
    expect(out.some((l) => l.includes('Step 2'))).toBe(true)
    // No tasks displayed — scheduling deferred to executeStep
    expect(out.some((l) => l.includes('status: running'))).toBe(true)
  })

  it('Step 2: after A+B complete, next executes C → run completed', async () => {
    const runId = await setupWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-06')

    // Execute step 0 (A)
    const prog1 = createProgram(registerNextCommand)
    await prog1.parseAsync(['node', 'dag', 'next', '--run', runId])

    // Execute step 1 (B)
    const prog2 = createProgram(registerNextCommand)
    await prog2.parseAsync(['node', 'dag', 'next', '--run', runId])

    // Execute step 2 (C)
    logSpy.mockClear()
    const prog3 = createProgram(registerNextCommand)
    await prog3.parseAsync(['node', 'dag', 'next', '--run', runId])

    expect(exitSpy).not.toHaveBeenCalled()
    const out = getLog()
    expect(out.some((l) => l.includes('C') && l.includes('success'))).toBe(true)
  })

  it('After A+B+C complete: next says run completed', async () => {
    const runId = await setupWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-07')

    // Execute all 3 steps
    const prog = createProgram(registerNextCommand)
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId])
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId])
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId])

    // Now try next again — run is completed
    logSpy.mockClear()
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId])

    expect(exitSpy).not.toHaveBeenCalled()
    const out = getLog()
    expect(
      out.some(
        (l) =>
          l.includes('Run completed') ||
          l.includes('no more steps') ||
          l.includes('No executable tasks'),
      ),
    ).toBe(true)
  })

  it('After A+B+C complete: next --all --json returns completed status', async () => {
    const runId = await setupWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-08')

    // Execute all 3 steps
    const prog = createProgram(registerNextCommand)
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId])
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId])
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId])

    // Now try next again with --json
    logSpy.mockClear()
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId, '--all', '--json'])

    expect(exitSpy).not.toHaveBeenCalled()
    const parsed = JSON.parse(getLog()[0]!)
    expect(parsed.executed).toEqual([])
    expect(parsed.completed).toBe(true)
  })

  it('next --run nonexistent exits with error', async () => {
    const prog = createProgram(registerNextCommand)
    await prog.parseAsync(['node', 'dag', 'next', '--run', 'nonexistent@000'])

    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
