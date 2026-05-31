import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../../../src/engine/default-deps.js'
import { initTmpDir, cleanupTmpDir } from '../../helpers/setup.js'
import {
  initRun,
  executeStep,
  executeNode,
  findTriggeredNodes,
  completeNodeExternal,
  setDefaultEngineDeps,
} from '../../../src/domain/engine/execution-engine.js'
import { generateChannels } from '../../../src/domain/compiler/channel-gen.js'
import { readState } from '../../../src/domain/engine/state-service.js'
import { FsTaskRepository } from '../../../src/infra/fs/fs-task-repo.js'
import { FsChannelRepository } from '../../../src/infra/fs/fs-channel-repo.js'
import type {
  CompiledGraph,
  CompiledNode,
  Edge,
  StateSchema,
  ChannelDef,
  State,
  BarrierChannel,
} from '../../../src/shared/models/compiled-graph.js'
import { isPlainEdge } from '../../../src/shared/models/compiled-graph.js'

// ─── Store instances for assertions ──────────────────────────────────

const taskStore = new FsTaskRepository()
const channelStore = new FsChannelRepository()

// ─── Topological Layer Computation ────────────────────────────────────

/**
 * Compute topological layers from a unified Edge[].
 * PlainEdge { from, to }: to depends on from.
 * ConditionalEdge { from, targets }: all targets depend on from.
 */
function computeSimpleLayers(nodeNames: string[], edges: Edge[]): string[][] {
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const n of nodeNames) inDegree.set(n, 0)

  for (const e of edges) {
    if (isPlainEdge(e)) {
      // PlainEdge: to depends on from
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1)
      const list = dependents.get(e.from) ?? []
      list.push(e.to)
      dependents.set(e.from, list)
    } else {
      // ConditionalEdge: all targets depend on from
      for (const target of e.targets) {
        inDegree.set(target, (inDegree.get(target) ?? 0) + 1)
        const list = dependents.get(e.from) ?? []
        list.push(target)
        dependents.set(e.from, list)
      }
    }
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

// ─── Test Graph Builder ──────────────────────────────────────────────

function buildTestGraph(
  nodeNames: string[],
  edges: Edge[] = [],
  graphName = 'test-graph',
  stateSchema: StateSchema = { result: null },
): CompiledGraph {
  const channelResult = generateChannels(nodeNames, edges)

  const nodes: Record<string, CompiledNode> = {}
  for (const name of nodeNames) {
    nodes[name] = {
      id: name,
      fn: () => ({ result: `done-${name}` }),
      strategies: channelResult.nodeStrategies[name] ?? [],
      triggeredBy: channelResult.nodeTriggeredBy[name] ?? '',
    }
    if (channelResult.routeTargets[name]) {
      // Rebuild the node with route and routeTargets (cannot assign readonly props)
      nodes[name] = {
        ...nodes[name]!,
        route: channelResult.routeTargets[name]!.fn,
        routeTargets: channelResult.routeTargets[name]!.targets,
      }
    }
  }

  const channels: Record<string, ChannelDef> = {}
  for (const [name, def] of Object.entries(channelResult.channels)) {
    channels[name] = def
  }

  return {
    name: graphName,
    nodes,
    stateSchema,
    channels,
    layers: computeSimpleLayers(nodeNames, edges),
  }
}

// ─── Run ID Generator ────────────────────────────────────────────────

let runCounter = 0
function nextRunId(graphName = 'test'): string {
  return `${graphName}-${++runCounter}-${Date.now()}`
}

// ─── Setup / Teardown ────────────────────────────────────────────────

beforeEach(() => {
  initTmpDir()
  runCounter = 0
})

afterEach(async () => {
  await cleanupTmpDir()
})

// ─── Helper: init a run and wire compileWorkflow mock ────────────────

async function setupRun(graph: CompiledGraph): Promise<string> {
  const runId = nextRunId(graph.name)
  setDefaultEngineDeps({
    compileWorkflow: async (name: string) => {
      if (name === graph.name) return graph
      throw new Error(`unknown graph '${name}'`)
    },
  })
  await initRun(runId, graph)
  return runId
}

// =====================================================================
// initRun
// =====================================================================

describe('initRun', () => {
  it('should create RunInfo with status running and step 0', async () => {
    const checkGraph = buildTestGraph(['A'], [], 'init-check')
    setDefaultEngineDeps({
      compileWorkflow: async () => checkGraph,
    })
    const checkRunId = nextRunId('init-check')
    const returned = await initRun(checkRunId, checkGraph)

    expect(returned.id).toBe(checkRunId)
    expect(returned.status).toBe('running')
    expect(returned.currentStep).toBe(0)
    expect(returned.graphName).toBe('init-check')
  })

  it('should init state with schema defaults', async () => {
    const graph = buildTestGraph(['A'], [], 'state-init', { count: 0, name: 'init' })
    const runId = await setupRun(graph)

    const state = await readState(runId)
    expect(state.count).toBe(0)
    expect(state.name).toBe('init')
  })

  it('should init channels from graph definition', async () => {
    // Edge A→B means A triggers B
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    const runId = await setupRun(graph)

    const channels = await channelStore.readAll(runId)

    // A triggers B → channel is trigger:B, written by A via DirectWrite strategy
    expect(channels['trigger:B']).toBeDefined()
    expect(channels['trigger:B']!.version).toBe(0)
  })

  it('should create tasks for layer 0 nodes with status ready', async () => {
    // Edge A→B: layer 0 = [A], layer 1 = [B]
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    const runId = await setupRun(graph)

    const tasks = await taskStore.readAll(runId)

    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.nodeId).toBe('A')
    expect(tasks[0]!.status).toBe('ready')
    expect(tasks[0]!.step).toBe(0)
  })

  it('should store graph reference without functions', async () => {
    const graph = buildTestGraph(['A'], [], 'graphref-test')
    let capturedRef: unknown = null

    setDefaultEngineDeps({
      writeJSON: async (_filePath: string, data: unknown) => {
        capturedRef = data
      },
      compileWorkflow: async () => graph,
    })

    const runId = nextRunId('graphref-test')
    await initRun(runId, graph)

    const graphRef = capturedRef as Record<string, unknown>
    expect(graphRef.name).toBe('graphref-test')
    expect(graphRef.nodeIds).toEqual(['A'])
    // Should contain structural data but no function properties
    expect(graphRef.stateSchema).toBeDefined()
    expect(graphRef.channels).toBeDefined()
    expect(graphRef.layers).toBeDefined()
  })
})

// =====================================================================
// executeStep
// =====================================================================

describe('executeStep', () => {
  it('should execute layer 0 tasks (single node A)', async () => {
    const graph = buildTestGraph(['A'])
    const runId = await setupRun(graph)

    const result = await executeStep(runId)

    expect(result.executed).toEqual(['A'])
    expect(result.completed).toBe(true)
  })

  it('should advance to next layer after all tasks complete', async () => {
    // Edge A→B: layer 0 = [A], layer 1 = [B]
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    const runId = await setupRun(graph)

    // Step 0: execute A (layer 0)
    const result0 = await executeStep(runId)
    expect(result0.executed).toEqual(['A'])
    expect(result0.completed).toBe(false)

    // Step 1: execute B (layer 1)
    const result1 = await executeStep(runId)
    expect(result1.executed).toEqual(['B'])
    expect(result1.completed).toBe(true)
  })

  it('should execute multi-node layer (A, B in same layer)', async () => {
    // A→C, B→C: layer 0 = [A, B], layer 1 = [C]
    const graph = buildTestGraph(
      ['A', 'B', 'C'],
      [
        { from: 'A', to: 'C' },
        { from: 'B', to: 'C' },
      ],
    )
    const runId = await setupRun(graph)

    const result0 = await executeStep(runId)
    expect(result0.executed.sort()).toEqual(['A', 'B'])
    expect(result0.completed).toBe(false)

    const result1 = await executeStep(runId)
    expect(result1.executed).toEqual(['C'])
    expect(result1.completed).toBe(true)
  })

  it('should handle linear chain A→B→C across multiple executeStep calls', async () => {
    // A→B→C: layer 0 = [A], layer 1 = [B], layer 2 = [C]
    const graph = buildTestGraph(
      ['A', 'B', 'C'],
      [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
      ],
    )
    const runId = await setupRun(graph)

    const result0 = await executeStep(runId)
    expect(result0.executed).toEqual(['A'])
    expect(result0.completed).toBe(false)

    const result1 = await executeStep(runId)
    expect(result1.executed).toEqual(['B'])
    expect(result1.completed).toBe(false)

    const result2 = await executeStep(runId)
    expect(result2.executed).toEqual(['C'])
    expect(result2.completed).toBe(true)
  })

  it('should detect run completion when no more layers exist', async () => {
    const graph = buildTestGraph(['A'])
    const runId = await setupRun(graph)

    const result0 = await executeStep(runId)
    expect(result0.completed).toBe(true)

    // Second call on completed run
    const result1 = await executeStep(runId)
    expect(result1.executed).toEqual([])
    expect(result1.completed).toBe(true)
  })

  it('should return empty executed list for completed run', async () => {
    const graph = buildTestGraph(['A'])
    const runId = await setupRun(graph)

    await executeStep(runId) // completes the run
    const result = await executeStep(runId)

    expect(result.executed).toEqual([])
    expect(result.completed).toBe(true)
  })

  it('should not advance when a task fails', async () => {
    // A→B: layer 0 = [A], layer 1 = [B]
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    // Override A's fn to throw
    graph.nodes['A']!.fn = () => {
      throw new Error('A failed')
    }
    const runId = await setupRun(graph)

    const result = await executeStep(runId)

    // A was attempted (and failed)
    expect(result.executed).toEqual(['A'])
    expect(result.completed).toBe(false)

    // Verify A's task is failed
    const tasks = await taskStore.readByStep(runId, 0)
    const taskA = tasks.find((t) => t.nodeId === 'A')
    expect(taskA?.status).toBe('failed')
  })
})

// =====================================================================
// executeNode
// =====================================================================

describe('executeNode', () => {
  it('should set task status to running then success', async () => {
    const graph = buildTestGraph(['A'])
    const runId = await setupRun(graph)

    await executeNode(runId, 'A', graph)

    const tasks = await taskStore.readAll(runId)
    expect(tasks[0]!.nodeId).toBe('A')
    expect(tasks[0]!.status).toBe('success')
  })

  it('should read state, execute fn, and patch state', async () => {
    const graph = buildTestGraph(['A'], [], 'exec-state', { counter: 0 })
    graph.nodes['A']!.fn = (state: State) => ({ counter: (state.counter as number) + 1 })

    const runId = await setupRun(graph)

    await executeNode(runId, 'A', graph)

    const state = await readState(runId)
    expect(state.counter).toBe(1)
  })

  it('should write trigger channels via DirectWrite strategy', async () => {
    // A→B: A has DirectWrite strategy for trigger:B
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    const runId = await setupRun(graph)

    // Execute A — should write trigger:B via DirectWrite
    await executeNode(runId, 'A', graph)

    const channels = await channelStore.readAll(runId)
    expect(channels['trigger:B']!.version).toBe(1)
  })

  it('should write barrier channels via DirectWrite strategy (multi-source join)', async () => {
    // A→C, B→C: C has multiple sources → barrier:C with writers [A, B]
    const graph = buildTestGraph(
      ['A', 'B', 'C'],
      [
        { from: 'A', to: 'C' },
        { from: 'B', to: 'C' },
      ],
    )
    const runId = await setupRun(graph)

    // Execute A — should write to barrier:C via DirectWrite
    await executeNode(runId, 'A', graph)

    const channels = await channelStore.readAll(runId)
    const barrierC = channels['barrier:C']! as BarrierChannel
    expect(barrierC).toBeDefined()
    expect(barrierC.type).toBe('barrier')
    // After one writer, barrier is not yet complete
    expect(barrierC.version).toBe(0)
    expect(barrierC.received).toContain('A')
  })

  it('should handle conditional routing (only trigger selected targets)', async () => {
    const routeFn = (state: State): string[] => {
      return state.goX ? ['X'] : ['Y']
    }

    // ConditionalEdge goes into the same edges array as PlainEdge
    const graph = buildTestGraph(
      ['R', 'X', 'Y'],
      [{ from: 'R', targets: ['X', 'Y'], fn: routeFn }],
      'cond-route',
      { goX: true },
    )
    const runId = await setupRun(graph)

    // Execute R — should trigger X (selected) but not Y (ConditionalWrite)
    await executeNode(runId, 'R', graph)

    const channels = await channelStore.readAll(runId)
    expect(channels['trigger:X']!.version).toBe(1)
    expect(channels['trigger:Y']!.version).toBe(0)
  })

  it('should set task to failed when fn throws', async () => {
    const graph = buildTestGraph(['A'])
    graph.nodes['A']!.fn = () => {
      throw new Error('boom')
    }
    const runId = await setupRun(graph)

    await expect(executeNode(runId, 'A', graph)).rejects.toThrow('boom')

    const tasks = await taskStore.readAll(runId)
    expect(tasks[0]!.status).toBe('failed')
    expect(tasks[0]!.error).toBe('boom')
  })
})

// =====================================================================
// findTriggeredNodes
// =====================================================================

describe('findTriggeredNodes', () => {
  it('should return all layer 0 nodes (entry nodes)', async () => {
    const graph = buildTestGraph(['A', 'B'])
    const runId = await setupRun(graph)

    const triggered = await findTriggeredNodes(runId, graph, 0)
    expect(triggered.sort()).toEqual(['A', 'B'])
  })

  it('should return nodes whose trigger channel has version > 0', async () => {
    // A→B: A has DirectWrite strategy for trigger:B, B is triggered by trigger:B
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    const runId = await setupRun(graph)

    // Execute A to trigger B's channel
    await executeNode(runId, 'A', graph)

    const triggered = await findTriggeredNodes(runId, graph, 1)
    expect(triggered).toEqual(['B'])
  })

  it('should return empty for layer with no triggered channels', async () => {
    // A→B: layer 0 = [A], layer 1 = [B]
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    const runId = await setupRun(graph)

    // Don't execute A — B's trigger channel stays at version 0
    const triggered = await findTriggeredNodes(runId, graph, 1)
    expect(triggered).toEqual([])
  })

  it('should return empty for nonexistent layer', async () => {
    const graph = buildTestGraph(['A'])
    const runId = await setupRun(graph)

    const triggered = await findTriggeredNodes(runId, graph, 99)
    expect(triggered).toEqual([])
  })
})

// =====================================================================
// completeNodeExternal
// =====================================================================

describe('completeNodeExternal', () => {
  it('should patch state and mark task as success', async () => {
    const graph = buildTestGraph(['A'], [], 'ext-complete', { value: null })
    const runId = await setupRun(graph)

    await completeNodeExternal(runId, 'A', { value: 'external-result' })

    const state = await readState(runId)
    expect(state.value).toBe('external-result')

    const tasks = await taskStore.readAll(runId)
    expect(tasks[0]!.status).toBe('success')
  })

  it('should execute strategies after completion', async () => {
    // A→B: A has DirectWrite strategy for trigger:B
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    const runId = await setupRun(graph)

    await completeNodeExternal(runId, 'A', {})

    const channels = await channelStore.readAll(runId)
    // A has DirectWrite strategy for trigger:B — should be triggered
    expect(channels['trigger:B']!.version).toBe(1)
  })

  it('should mark task as failed on error', async () => {
    const graph = buildTestGraph(['A'], [], 'ext-fail', { x: 1 })
    const runId = await setupRun(graph)

    // Override stateStore.patch to throw after task is set to 'running'
    setDefaultEngineDeps({
      compileWorkflow: async (name: string) => {
        if (name === 'ext-fail') return graph
        throw new Error(`unknown graph '${name}'`)
      },
      stateStore: {
        init: async () => {},
        read: async () => ({ x: 1 }),
        patch: async () => {
          throw new Error('state write failed')
        },
        reset: async () => {},
      },
    })

    await expect(completeNodeExternal(runId, 'A', { x: 2 })).rejects.toThrow('state write failed')

    const tasks = await taskStore.readAll(runId)
    const taskA = tasks.find((t) => t.nodeId === 'A')
    expect(taskA?.status).toBe('failed')
    expect(taskA?.error).toBe('state write failed')
  })
})
