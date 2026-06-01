/**
 * Execution engine for the new compiled-graph architecture.
 *
 * Core runtime: initializes runs, executes nodes, manages channel writes,
 * and advances through topological layers (supersteps).
 */

import { match } from 'ts-pattern'
import type {
  ChannelStore,
  RunStore,
  StateStore,
  TaskStore,
} from '../../shared/models/store-repository.js'
import type {
  ChannelDef,
  CompiledGraph,
  CompiledNode,
  RunInfo,
  State,
  Task,
} from '../../shared/models/compiled-graph.js'
import type { Clock } from '../../shared/utils/clock.js'
import { createTask, isTerminalStatus } from '../../shared/models/compiled-graph.js'

// ── DI Pattern ──────────────────────────────────────────────────────

export interface EngineDeps {
  stateStore?: StateStore
  channelStore?: ChannelStore
  taskStore?: TaskStore
  runStore?: RunStore
  clock?: Clock
  /** Write JSON to a file path */
  writeJSON?: (filePath: string, data: unknown) => Promise<void>
  /** Get graph.json file path for a run */
  getGraphFile?: (runId: string) => string
  /** Re-compile workflow to get CompiledGraph with functions */
  compileWorkflow?: (name: string) => Promise<CompiledGraph>
}

let _defaults: Partial<EngineDeps> = {}

/** Set default deps — called by engine/composition root at startup */
export function setDefaultEngineDeps(defaults: Partial<EngineDeps>): void {
  _defaults = { ..._defaults, ...defaults }
}

function resolveEngineDeps(deps?: EngineDeps) {
  const merged = { ..._defaults, ...deps }
  return {
    stateStore: merged.stateStore!,
    channelStore: merged.channelStore!,
    taskStore: merged.taskStore!,
    runStore: merged.runStore!,
    clock: merged.clock!,
    writeJSON: merged.writeJSON!,
    getGraphFile: merged.getGraphFile!,
    compileWorkflow: merged.compileWorkflow!,
  }
}

// ── Graph Serialization ─────────────────────────────────────────────

/**
 * Serializable graph reference — stores structural data without functions.
 * Written to graph.json for inspection; functions are re-loaded at execution time.
 */
interface GraphRef {
  readonly name: string
  readonly nodeIds: string[]
  readonly channels: Record<string, { type: 'trigger' | 'barrier'; writers?: string[] }>
  readonly layers: string[][]
  readonly stateSchema: Record<string, unknown>
  readonly version?: string
  readonly description?: string
}

/** Convert a CompiledGraph to a serializable GraphRef (strips functions) */
function toGraphRef(graph: CompiledGraph): GraphRef {
  return {
    name: graph.name,
    nodeIds: Object.keys(graph.nodes),
    channels: graph.channels,
    layers: graph.layers,
    stateSchema: graph.stateSchema,
    version: graph.version,
    description: graph.description,
  }
}

// ── API ─────────────────────────────────────────────────────────────

/**
 * Initialize a new run:
 * 1. Store graph reference to graph.json
 * 2. Init state from stateSchema
 * 3. Init channels from compiled graph
 * 4. Create RunInfo (tasks are NOT created here — deferred to executeStep scheduling phase)
 */
export async function initRun(
  runId: string,
  graph: CompiledGraph,
  deps?: EngineDeps,
): Promise<RunInfo> {
  const d = resolveEngineDeps(deps)

  // 1. Store graph reference (structural data only, no functions)
  await d.writeJSON(d.getGraphFile(runId), toGraphRef(graph))

  // 2. Init state from schema
  await d.stateStore.init(runId, graph.stateSchema)

  // 3. Init channels
  await d.channelStore.init(runId, graph.channels)

  // 4. Create RunInfo — scheduling deferred to executeStep()
  const info: RunInfo = {
    id: runId,
    createdAt: d.clock(),
    graphName: graph.name,
    currentStep: 0,
    currentStepScheduled: false,
    status: 'running',
  }

  await d.runStore.create(info)

  return info
}

/**
 * Execute the next step with a clear four-phase flow:
 *
 * Phase A — Boundary Defense: early return for completed/invalid states
 * Phase B — Scheduling: if currentStepScheduled=false, find triggered nodes,
 *           create tasks, mark scheduled=true. Auto-advance through empty layers.
 * Phase C — Execution: run all ready tasks
 * Phase D — Settlement: check terminality, handle failures, advance step
 */
export async function executeStep(
  runId: string,
  deps?: EngineDeps,
): Promise<{ executed: string[]; completed: boolean }> {
  const d = resolveEngineDeps(deps)

  // ── Phase A: Boundary Defense ──────────────────────────────────
  const info = await d.runStore.read(runId)

  if (info.status === 'completed') {
    return { executed: [], completed: true }
  }

  const graphName = info.graphName
  if (!graphName) {
    throw new Error(`run '${runId}' is not bound to a graph`)
  }
  const graph = await d.compileWorkflow(graphName)
  const step = info.currentStep

  // Past all layers — mark completed
  if (step >= graph.layers.length) {
    await d.runStore.update(runId, { status: 'completed' })
    return { executed: [], completed: true }
  }

  // ── Phase B: Scheduling ────────────────────────────────────────
  if (!info.currentStepScheduled) {
    const triggered = await findTriggeredNodes(runId, graph, step, deps)

    if (triggered.length === 0) {
      // Auto-advance through empty layers (e.g., all conditional edges skipped)
      const result = await autoAdvanceEmptyLayers(runId, graph, step, deps)
      if (result.completed) {
        return { executed: [], completed: true }
      }
      // Found a layer with work — re-enter scheduling at the new step
      return executeStep(runId, deps)
    }

    // Idempotent guard: skip task creation if tasks already exist (crash recovery)
    const existing = await d.taskStore.readByStep(runId, step)
    if (existing.length === 0) {
      const newTasks: Task[] = triggered.map((nodeId) => createTask(nodeId, step))
      await d.taskStore.create(runId, newTasks)
    }

    // Mark step as scheduled
    const runUpdate: Partial<RunInfo> = { currentStepScheduled: true }

    // Auto-restore: if paused and now scheduling tasks, resume to running
    if (info.status === 'paused_for_intervention') {
      runUpdate.status = 'running'
    }

    await d.runStore.update(runId, runUpdate)
  }

  // ── Phase C: Execution ─────────────────────────────────────────
  const tasks = await d.taskStore.readByStep(runId, step)
  const executed: string[] = []

  for (const task of tasks) {
    if (task.status !== 'ready') continue

    try {
      await executeNode(runId, task.nodeId, graph, deps)
      executed.push(task.nodeId)
    } catch {
      // executeNode handles task failure internally
      executed.push(task.nodeId)
    }
  }

  // ── Phase D: Settlement ────────────────────────────────────────
  const updatedTasks = await d.taskStore.readByStep(runId, step)
  const allTerminal = updatedTasks.every((t) => isTerminalStatus(t.status))

  if (!allTerminal) {
    return { executed, completed: false }
  }

  // Any failed → pause for intervention
  const anyFailed = updatedTasks.some((t) => t.status === 'failed')
  if (anyFailed) {
    await d.runStore.update(runId, { status: 'paused_for_intervention' })
    return { executed, completed: false }
  }

  // All success — advance to next step
  const nextStep = step + 1

  if (nextStep >= graph.layers.length) {
    await d.runStore.update(runId, { status: 'completed' })
    return { executed, completed: true }
  }

  await d.runStore.update(runId, {
    currentStep: nextStep,
    currentStepScheduled: false,
    status: 'running', // restore from paused_for_intervention if was retrying
  })

  return { executed, completed: false }
}

/**
 * Auto-advance through consecutive empty layers (no triggered nodes).
 * Returns when it finds a layer with work, or completes the run.
 */
async function autoAdvanceEmptyLayers(
  runId: string,
  graph: CompiledGraph,
  startStep: number,
  deps?: EngineDeps,
): Promise<{ completed: boolean }> {
  const d = resolveEngineDeps(deps)
  let step = startStep

  while (step < graph.layers.length) {
    const triggered = await findTriggeredNodes(runId, graph, step, deps)

    if (triggered.length > 0) {
      // Found a layer with work — create tasks and mark scheduled
      // Idempotent guard: skip task creation if tasks already exist (crash recovery)
      const existing = await d.taskStore.readByStep(runId, step)
      if (existing.length === 0) {
        const newTasks: Task[] = triggered.map((nodeId) => createTask(nodeId, step))
        await d.taskStore.create(runId, newTasks)
      }
      await d.runStore.update(runId, {
        currentStep: step,
        currentStepScheduled: true,
      })
      return { completed: false }
    }

    // Empty layer — skip it
    step++
  }

  // No more layers with work — run is complete
  await d.runStore.update(runId, { status: 'completed' })
  return { completed: true }
}

/**
 * Execute a single node:
 * 1. Update task status to 'running'
 * 2. Read state
 * 3. Execute node.fn(state) → patch
 * 4. Merge patch into state
 * 5. Execute write strategies (trigger, barrier, conditional routing)
 * 6. Update task status to 'success'
 */
export async function executeNode(
  runId: string,
  nodeId: string,
  graph: CompiledGraph,
  deps?: EngineDeps,
): Promise<void> {
  const d = resolveEngineDeps(deps)

  const node = graph.nodes[nodeId]
  if (!node) {
    throw new Error(`node '${nodeId}' not found in compiled graph`)
  }

  // Read run info to determine step
  const info = await d.runStore.read(runId)
  const step = info.currentStep

  // 1. Update task status to 'running'
  await d.taskStore.updateStatus(runId, nodeId, step, 'running')

  try {
    // 2. Read state
    const state = await d.stateStore.read(runId)

    // 3. Execute node function → patch
    const patch = node.fn(state)

    // 4. Merge patch into state
    await d.stateStore.patch(runId, patch)

    // 5. Execute write strategies (use post-patch state so route functions
    //    can read keys written by the current node)
    await executeStrategies(runId, node, graph.channels, { ...state, ...patch }, deps)

    // 6. Update task status to 'success'
    await d.taskStore.updateStatus(runId, nodeId, step, 'success')
  } catch (err) {
    // Update task status to 'failed' with error message
    const message = err instanceof Error ? err.message : String(err)
    await d.taskStore.updateStatus(runId, nodeId, step, 'failed', message)
    throw err
  }
}

/**
 * Find which nodes in a given layer are triggered (their trigger channel version > 0).
 * Entry nodes (layer 0, no trigger channel required) are always considered triggered.
 */
export async function findTriggeredNodes(
  runId: string,
  graph: CompiledGraph,
  layer: number,
  deps?: EngineDeps,
): Promise<string[]> {
  const d = resolveEngineDeps(deps)
  const layerNodes = graph.layers[layer]

  if (!layerNodes || layerNodes.length === 0) {
    return []
  }

  // Layer 0 nodes are entry nodes — they don't need a trigger
  if (layer === 0) {
    return [...layerNodes]
  }

  const triggered: string[] = []

  for (const nodeId of layerNodes) {
    const node = graph.nodes[nodeId]
    if (!node) continue

    const version = await d.channelStore.getVersion(runId, node.triggeredBy)
    if (version > 0) {
      triggered.push(nodeId)
    }
  }

  return triggered
}

// ── Internal Helpers ────────────────────────────────────────────────

/**
 * Execute all write strategies for a node after successful execution.
 *
 * For each strategy:
 * - DirectWrite: always write to the bound channel
 * - ConditionalWrite: write only if route selected the target
 *
 * How to write depends on channel type (looked up from graph channels):
 * - trigger channel → channelStore.trigger()
 * - barrier channel → channelStore.barrierWrite(runId, channel, nodeId)
 */
async function executeStrategies(
  runId: string,
  node: CompiledNode,
  channels: Record<string, ChannelDef>,
  state: State,
  deps?: EngineDeps,
): Promise<void> {
  const d = resolveEngineDeps(deps)

  // If this node has a route function, evaluate it to determine selected targets
  let selectedTargets: Set<string> | undefined
  if (node.route) {
    const selected = node.route(state)
    selectedTargets = new Set(selected)
  }

  for (const strategy of node.strategies) {
    // Determine if we should write
    const shouldWrite = match(strategy)
      .with({ type: 'direct' }, () => true)
      .with({ type: 'conditional' }, (s) => selectedTargets?.has(s.target) ?? false)
      .exhaustive()

    if (!shouldWrite) continue

    // Look up channel type and write appropriately
    const channelDef = channels[strategy.channel]
    if (!channelDef) continue

    if (channelDef.type === 'trigger') {
      await d.channelStore.trigger(runId, strategy.channel)
    } else {
      await d.channelStore.barrierWrite(runId, strategy.channel, node.id)
    }
  }
}
