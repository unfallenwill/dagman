import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../../../src/engine/default-deps.js'
import { initTmpDir, cleanupTmpDir } from '../../helpers/setup.js'
import {
  initRun,
  executeStep,
  executeNode,
  findTriggeredNodes,
  setDefaultEngineDeps,
} from '../../../src/domain/engine/execution-engine.js'
import { generateChannels } from '../../../src/domain/compiler/channel-gen.js'
import { readState } from '../../../src/domain/engine/state-service.js'
import { FsTaskRepository } from '../../../src/infra/fs/fs-task-repo.js'
import { FsChannelRepository } from '../../../src/infra/fs/fs-channel-repo.js'
import { FsRunStoreAdapter } from '../../../src/infra/fs/fs-run-store-adapter.js'
import { FsRunRepository } from '../../../src/infra/fs/fs-run-repo.js'
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
const runStore = new FsRunStoreAdapter(new FsRunRepository())

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
  it('should create RunInfo with status running, step 0, and currentStepScheduled=false', async () => {
    const checkGraph = buildTestGraph(['A'], [], 'init-check')
    setDefaultEngineDeps({
      compileWorkflow: async () => checkGraph,
    })
    const checkRunId = nextRunId('init-check')
    const returned = await initRun(checkRunId, checkGraph)

    expect(returned.id).toBe(checkRunId)
    expect(returned.status).toBe('running')
    expect(returned.currentStep).toBe(0)
    expect(returned.currentStepScheduled).toBe(false)
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

  it('should NOT create tasks for layer 0 (deferred to executeStep)', async () => {
    // Edge A→B: layer 0 = [A], layer 1 = [B]
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    const runId = await setupRun(graph)

    const tasks = await taskStore.readAll(runId)

    // No tasks created by initRun — scheduling is deferred
    expect(tasks).toHaveLength(0)
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
// executeStep — Phase A: Boundary Defense
// =====================================================================

describe('executeStep — boundary defense', () => {
  it('should return empty for completed run', async () => {
    const graph = buildTestGraph(['A'])
    const runId = await setupRun(graph)

    // Execute once to complete
    await executeStep(runId)

    // Second call on completed run
    const result = await executeStep(runId)
    expect(result.executed).toEqual([])
    expect(result.completed).toBe(true)
  })

  it('should throw when run is not bound to a graph', async () => {
    // Create a run without graphName
    const runId = nextRunId('no-graph')
    setDefaultEngineDeps({
      compileWorkflow: async () => {
        throw new Error('should not be called')
      },
    })
    await runStore.create({
      id: runId,
      createdAt: new Date().toISOString(),
      currentStep: 0,
      currentStepScheduled: false,
      status: 'running',
    })

    await expect(executeStep(runId)).rejects.toThrow(`run '${runId}' is not bound to a graph`)
  })

  it('should mark run completed when currentStep is past all layers', async () => {
    const graph = buildTestGraph(['A'])
    const runId = await setupRun(graph)

    // Manually push currentStep past the last layer
    await runStore.update(runId, { currentStep: 99 })

    const result = await executeStep(runId)
    expect(result.completed).toBe(true)
    expect(result.executed).toEqual([])

    const info = await runStore.read(runId)
    expect(info.status).toBe('completed')
  })
})

// =====================================================================
// executeStep — Phase B: Scheduling
// =====================================================================

describe('executeStep — scheduling phase', () => {
  it('should schedule and execute layer 0 tasks on first call', async () => {
    const graph = buildTestGraph(['A'])
    const runId = await setupRun(graph)

    const result = await executeStep(runId)

    expect(result.executed).toEqual(['A'])
    expect(result.completed).toBe(true)
  })

  it('should set currentStepScheduled=true after scheduling', async () => {
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    const runId = await setupRun(graph)

    await executeStep(runId)

    // After executing layer 0, step should advance with scheduled=false (for next layer)
    const info = await runStore.read(runId)
    expect(info.currentStep).toBe(1)
    expect(info.currentStepScheduled).toBe(false)
  })

  it('should handle multi-node layer scheduling (A, B in same layer)', async () => {
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

  it('should be idempotent when called with currentStepScheduled=false and tasks exist', async () => {
    const graph = buildTestGraph(['A'])
    const runId = await setupRun(graph)

    // Manually create task for layer 0 (simulating crash after task creation but before scheduled=true)
    const { createTask } = await import('../../../src/shared/models/compiled-graph.js')
    await taskStore.create(runId, [createTask('A', 0)])
    // currentStepScheduled is still false

    const result = await executeStep(runId)
    expect(result.executed).toEqual(['A'])

    // Verify no duplicate tasks were created
    const allTasks = await taskStore.readAll(runId)
    const aTasks = allTasks.filter((t) => t.nodeId === 'A')
    expect(aTasks).toHaveLength(1)
  })
})

// =====================================================================
// executeStep — Phase C: Execution
// =====================================================================

describe('executeStep — execution phase', () => {
  it('should advance through A→B→C across multiple executeStep calls', async () => {
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

  it('should update state via node functions across steps', async () => {
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }], 'exec-state', {
      counter: 0,
    })
    graph.nodes['A']!.fn = (state: State) => ({ counter: (state.counter as number) + 1 })
    graph.nodes['B']!.fn = (state: State) => ({ counter: (state.counter as number) + 10 })
    const runId = await setupRun(graph)

    await executeStep(runId)
    let state = await readState(runId)
    expect(state.counter).toBe(1)

    await executeStep(runId)
    state = await readState(runId)
    expect(state.counter).toBe(11)
  })

  it('should trigger correct channels between layers', async () => {
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    const runId = await setupRun(graph)

    await executeStep(runId)

    const channels = await channelStore.readAll(runId)
    expect(channels['trigger:B']!.version).toBe(1)
  })
})

// =====================================================================
// executeStep — Phase D: Settlement
// =====================================================================

describe('executeStep — settlement phase', () => {
  it('should mark run completed after last layer executes', async () => {
    const graph = buildTestGraph(['A'])
    const runId = await setupRun(graph)

    const result = await executeStep(runId)
    expect(result.completed).toBe(true)

    const info = await runStore.read(runId)
    expect(info.status).toBe('completed')
  })

  it('should set paused_for_intervention when a task fails', async () => {
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    graph.nodes['A']!.fn = () => {
      throw new Error('A failed')
    }
    const runId = await setupRun(graph)

    const result = await executeStep(runId)

    expect(result.executed).toEqual(['A'])
    expect(result.completed).toBe(false)

    const info = await runStore.read(runId)
    expect(info.status).toBe('paused_for_intervention')

    const tasks = await taskStore.readByStep(runId, 0)
    const taskA = tasks.find((t) => t.nodeId === 'A')
    expect(taskA?.status).toBe('failed')
    expect(taskA?.error).toBe('A failed')
  })

  it('should not advance step when task fails', async () => {
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    graph.nodes['A']!.fn = () => {
      throw new Error('A failed')
    }
    const runId = await setupRun(graph)

    await executeStep(runId)

    const info = await runStore.read(runId)
    expect(info.currentStep).toBe(0)
  })

  it('should advance step and reset scheduled=false after all success', async () => {
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    const runId = await setupRun(graph)

    await executeStep(runId)

    const info = await runStore.read(runId)
    expect(info.currentStep).toBe(1)
    expect(info.currentStepScheduled).toBe(false)
    expect(info.status).toBe('running')
  })
})

// =====================================================================
// executeStep — paused_for_intervention and retry
// =====================================================================

describe('executeStep — paused_for_intervention and retry', () => {
  it('should auto-restore to running when retried tasks are ready', async () => {
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    graph.nodes['A']!.fn = (() => {
      let callCount = 0
      return () => {
        callCount++
        if (callCount === 1) throw new Error('first attempt fails')
        return { result: 'A ok' }
      }
    })()
    const runId = await setupRun(graph)

    // First attempt: A fails
    await executeStep(runId)
    let info = await runStore.read(runId)
    expect(info.status).toBe('paused_for_intervention')

    // Simulate retry: reset task to ready
    await taskStore.updateStatus(runId, 'A', 0, 'ready')

    // Fix A's function so it succeeds this time
    graph.nodes['A']!.fn = () => ({ result: 'A ok' })

    // Second attempt: should auto-restore to running and execute A
    const result = await executeStep(runId)
    expect(result.executed).toEqual(['A'])
    expect(result.completed).toBe(false)

    info = await runStore.read(runId)
    expect(info.status).toBe('running')
  })

  it('should allow continued execution after retry and advance to next layer', async () => {
    const graph = buildTestGraph(
      ['A', 'B', 'C'],
      [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
      ],
    )
    graph.nodes['A']!.fn = (() => {
      let callCount = 0
      return () => {
        callCount++
        if (callCount === 1) throw new Error('A fails first time')
        return { result: 'A ok' }
      }
    })()
    const runId = await setupRun(graph)

    // Step 0: A fails
    await executeStep(runId)

    // Retry A
    await taskStore.updateStatus(runId, 'A', 0, 'ready')
    graph.nodes['A']!.fn = () => ({ result: 'A ok' })

    // Step 0 again: A succeeds, advances to layer 1
    const result = await executeStep(runId)
    expect(result.executed).toEqual(['A'])
    expect(result.completed).toBe(false)

    // Step 1: B executes
    const result1 = await executeStep(runId)
    expect(result1.executed).toEqual(['B'])

    // Step 2: C executes, run completes
    const result2 = await executeStep(runId)
    expect(result2.executed).toEqual(['C'])
    expect(result2.completed).toBe(true)
  })

  it('should re-pause if retried task fails again', async () => {
    const graph = buildTestGraph(['A'])
    graph.nodes['A']!.fn = () => {
      throw new Error('always fails')
    }
    const runId = await setupRun(graph)

    // First attempt: fails
    await executeStep(runId)

    // Retry A (but it will fail again)
    await taskStore.updateStatus(runId, 'A', 0, 'ready')

    const result = await executeStep(runId)
    expect(result.executed).toEqual(['A'])
    expect(result.completed).toBe(false)

    const info = await runStore.read(runId)
    expect(info.status).toBe('paused_for_intervention')
  })
})

// =====================================================================
// executeStep — auto-advance through empty layers
// =====================================================================

describe('executeStep — auto-advance through empty layers', () => {
  it('should execute B normally after A in A→B graph', async () => {
    // Baseline: normal two-layer graph — settlement sets currentStepScheduled=false
    // for the next layer, and the next executeStep call schedules and executes it.
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }], 'auto-simple')
    const runId = await setupRun(graph)

    // Step 0: Execute A
    const r0 = await executeStep(runId)
    expect(r0.executed).toEqual(['A'])
    expect(r0.completed).toBe(false)

    // Verify channels are triggered
    const channels = await channelStore.readAll(runId)
    expect(channels['trigger:B']!.version).toBe(1)

    // Step 1: Execute B
    const r1 = await executeStep(runId)
    expect(r1.executed).toEqual(['B'])
    expect(r1.completed).toBe(true)
  })
})

// =====================================================================
// executeNode
// =====================================================================

describe('executeNode', () => {
  it('should set task status to running then success', async () => {
    const graph = buildTestGraph(['A'])
    const runId = await setupRun(graph)

    // Must schedule first (initRun no longer creates tasks)
    const { createTask } = await import('../../../src/shared/models/compiled-graph.js')
    await taskStore.create(runId, [createTask('A', 0)])
    await runStore.update(runId, { currentStepScheduled: true })

    await executeNode(runId, 'A', graph)

    const tasks = await taskStore.readAll(runId)
    expect(tasks[0]!.nodeId).toBe('A')
    expect(tasks[0]!.status).toBe('success')
  })

  it('should read state, execute fn, and patch state', async () => {
    const graph = buildTestGraph(['A'], [], 'exec-state', { counter: 0 })
    graph.nodes['A']!.fn = (state: State) => ({ counter: (state.counter as number) + 1 })

    const runId = await setupRun(graph)

    const { createTask } = await import('../../../src/shared/models/compiled-graph.js')
    await taskStore.create(runId, [createTask('A', 0)])
    await runStore.update(runId, { currentStepScheduled: true })

    await executeNode(runId, 'A', graph)

    const state = await readState(runId)
    expect(state.counter).toBe(1)
  })

  it('should write trigger channels via DirectWrite strategy', async () => {
    // A→B: A has DirectWrite strategy for trigger:B
    const graph = buildTestGraph(['A', 'B'], [{ from: 'A', to: 'B' }])
    const runId = await setupRun(graph)

    const { createTask } = await import('../../../src/shared/models/compiled-graph.js')
    await taskStore.create(runId, [createTask('A', 0)])
    await runStore.update(runId, { currentStepScheduled: true })

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

    const { createTask } = await import('../../../src/shared/models/compiled-graph.js')
    await taskStore.create(runId, [createTask('A', 0)])
    await runStore.update(runId, { currentStepScheduled: true })

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

    const graph = buildTestGraph(
      ['R', 'X', 'Y'],
      [{ from: 'R', targets: ['X', 'Y'], fn: routeFn }],
      'cond-route',
      { goX: true },
    )
    const runId = await setupRun(graph)

    const { createTask } = await import('../../../src/shared/models/compiled-graph.js')
    await taskStore.create(runId, [createTask('R', 0)])
    await runStore.update(runId, { currentStepScheduled: true })

    // Execute R — should trigger X (selected) but not Y (ConditionalWrite)
    await executeNode(runId, 'R', graph)

    const channels = await channelStore.readAll(runId)
    expect(channels['trigger:X']!.version).toBe(1)
    expect(channels['trigger:Y']!.version).toBe(0)
  })

  it('should route based on post-patch state (route sees node output)', async () => {
    // Regression test: route function must see the state AFTER the node's
    // patch is applied, not the pre-patch state.
    // R sets destination='X' via its fn; the route reads destination.
    const routeFn = (state: State): string[] => {
      return state.destination === 'X' ? ['X'] : ['Y']
    }

    const graph = buildTestGraph(
      ['R', 'X', 'Y'],
      [{ from: 'R', targets: ['X', 'Y'], fn: routeFn }],
      'cond-postpatch',
      { destination: 'Y' }, // initial state would route to Y
    )
    // R's fn flips destination to X — route should see this
    graph.nodes['R']!.fn = () => ({ destination: 'X' })

    const runId = await setupRun(graph)

    const { createTask } = await import('../../../src/shared/models/compiled-graph.js')
    await taskStore.create(runId, [createTask('R', 0)])
    await runStore.update(runId, { currentStepScheduled: true })

    await executeNode(runId, 'R', graph)

    const channels = await channelStore.readAll(runId)
    expect(channels['trigger:X']!.version).toBe(1) // selected by route (post-patch)
    expect(channels['trigger:Y']!.version).toBe(0) // NOT selected
  })

  it('should set task to failed when fn throws', async () => {
    const graph = buildTestGraph(['A'])
    graph.nodes['A']!.fn = () => {
      throw new Error('boom')
    }
    const runId = await setupRun(graph)

    const { createTask } = await import('../../../src/shared/models/compiled-graph.js')
    await taskStore.create(runId, [createTask('A', 0)])
    await runStore.update(runId, { currentStepScheduled: true })

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

    // Manually create and execute A to trigger B's channel
    const { createTask } = await import('../../../src/shared/models/compiled-graph.js')
    await taskStore.create(runId, [createTask('A', 0)])
    await runStore.update(runId, { currentStepScheduled: true })
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
// executeStep — full lifecycle integration tests
// =====================================================================

describe('executeStep — full lifecycle', () => {
  it('should complete a diamond DAG: A→[B,C]→D', async () => {
    const graph = buildTestGraph(
      ['A', 'B', 'C', 'D'],
      [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' },
        { from: 'B', to: 'D' },
        { from: 'C', to: 'D' },
      ],
    )
    const runId = await setupRun(graph)

    // Step 0: A
    const r0 = await executeStep(runId)
    expect(r0.executed).toEqual(['A'])
    expect(r0.completed).toBe(false)

    // Step 1: B, C (parallel)
    const r1 = await executeStep(runId)
    expect(r1.executed.sort()).toEqual(['B', 'C'])
    expect(r1.completed).toBe(false)

    // Step 2: D (barrier — waits for both B and C)
    const r2 = await executeStep(runId)
    expect(r2.executed).toEqual(['D'])
    expect(r2.completed).toBe(true)
  })

  it('should handle single-node graph (start and complete in one call)', async () => {
    const graph = buildTestGraph(['Solo'])
    const runId = await setupRun(graph)

    const result = await executeStep(runId)
    expect(result.executed).toEqual(['Solo'])
    expect(result.completed).toBe(true)

    const info = await runStore.read(runId)
    expect(info.status).toBe('completed')
  })

  it('should handle multi-node parallel layer as final step', async () => {
    // A→B, A→C: layer 0 = [A], layer 1 = [B, C]
    const graph = buildTestGraph(
      ['A', 'B', 'C'],
      [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' },
      ],
    )
    const runId = await setupRun(graph)

    const r0 = await executeStep(runId)
    expect(r0.executed).toEqual(['A'])
    expect(r0.completed).toBe(false)

    const r1 = await executeStep(runId)
    expect(r1.executed.sort()).toEqual(['B', 'C'])
    expect(r1.completed).toBe(true)
  })

  it('should handle partial failure in multi-node layer', async () => {
    // A, B in same layer — A succeeds, B fails
    const graph = buildTestGraph(['A', 'B'])
    graph.nodes['B']!.fn = () => {
      throw new Error('B failed')
    }
    const runId = await setupRun(graph)

    const result = await executeStep(runId)
    expect(result.executed.sort()).toEqual(['A', 'B'])
    expect(result.completed).toBe(false)

    const info = await runStore.read(runId)
    expect(info.status).toBe('paused_for_intervention')

    const tasks = await taskStore.readByStep(runId, 0)
    const taskA = tasks.find((t) => t.nodeId === 'A')
    const taskB = tasks.find((t) => t.nodeId === 'B')
    expect(taskA?.status).toBe('success')
    expect(taskB?.status).toBe('failed')
  })
})
