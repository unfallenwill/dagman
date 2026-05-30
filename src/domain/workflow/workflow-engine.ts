import type { Event } from '../../shared/models/event.js'
import type { Channel } from '../../shared/models/channel.js'
import {
  globalChannelName,
  edgeChannelName,
  isNodeChannel,
  isGlobalChannel,
  GLOBAL_CHANNEL_PREFIX,
} from '../../shared/models/channel.js'
import type { Task } from '../../shared/models/task.js'
import { createTask, isTerminalStatus, canTransition } from '../../shared/models/task.js'
import type {
  WorkflowRecord,
  WorkflowState,
  SuperstepStatus,
} from '../../shared/models/superstep.js'
import type { Edge } from '../../shared/models/graph.js'
import type {
  WorkflowRepository,
  EventRepository,
  RunRepository,
} from '../../shared/models/repository.js'
import type { Clock } from '../../shared/utils/clock.js'
import { systemClock } from '../../shared/utils/clock.js'
import { aggregateChannels, computeEdgeChannelUpdates } from './channel-ops.js'
import { createTasksForLayer, getFanoutItemsForNode } from './superstep-logic.js'
import { computeTopologicalLayers } from '../../shared/utils/topology.js'

// ===== Dependency Injection =====

export interface WorkflowDeps {
  clock?: Clock
  repo?: WorkflowRepository
  eventRepo?: EventRepository
  runRepo?: RunRepository
}

let _defaults: WorkflowDeps = {}

/** Set default deps — called by engine/composition root at startup */
export function setDefaultWorkflowDeps(defaults: WorkflowDeps): void {
  _defaults = { ..._defaults, ...defaults }
}

function resolveDeps(deps?: WorkflowDeps): Required<WorkflowDeps> {
  const merged = { ..._defaults, ...deps }
  return {
    clock: merged.clock ?? systemClock,
    repo: merged.repo!,
    eventRepo: merged.eventRepo!,
    runRepo: merged.runRepo!,
  }
}

// ===== Event Access =====

export async function getEvents(runId: string, deps?: WorkflowDeps): Promise<Event[]> {
  const { eventRepo } = resolveDeps(deps)
  return eventRepo.readEvents(runId)
}

// ===== State Loading =====

export async function loadState(runId: string, deps?: WorkflowDeps): Promise<WorkflowState> {
  const { repo } = resolveDeps(deps)
  const records = await repo.readRecords(runId)
  if (records.length === 0) {
    throw new Error('workflow not initialized')
  }

  return {
    channels: aggregateChannels(records),
    currentRecord: records[records.length - 1]!,
  }
}

// ===== Channel Operations =====

export async function getChannel(
  name: string,
  runId: string,
  deps?: WorkflowDeps,
): Promise<Channel | null> {
  const state = await loadState(runId, deps)
  return state.channels[name] ?? null
}

export async function getChannelVersion(
  name: string,
  runId: string,
  deps?: WorkflowDeps,
): Promise<number> {
  const ch = await getChannel(name, runId, deps)
  return ch?.version ?? 0
}

export async function listChannels(
  runId: string,
  nodeName?: string,
  deps?: WorkflowDeps,
): Promise<Channel[]> {
  const state = await loadState(runId, deps)
  const all = Object.values(state.channels)
  if (!nodeName) return all

  if (nodeName === GLOBAL_CHANNEL_PREFIX) {
    return all.filter((ch) => isGlobalChannel(ch.name))
  }
  return all.filter((ch) => isNodeChannel(ch.name, nodeName))
}

export async function setChannel(
  name: string,
  value: unknown,
  runId: string,
  deps?: WorkflowDeps,
): Promise<Channel> {
  const { clock, repo } = resolveDeps(deps)
  const state = await loadState(runId, deps)
  const existing = state.channels[name]
  const now = clock()

  const channel: Channel = {
    name,
    value,
    version: (existing?.version ?? 0) + 1,
    updatedAt: now,
  }

  const record: WorkflowRecord = {
    ...state.currentRecord,
    channelChanges: {
      ...state.currentRecord.channelChanges,
      [name]: channel,
    },
  }

  await repo.appendRecord(runId, record)
  return channel
}

export async function clearChannels(
  nodeName: string,
  runId: string,
  deps?: WorkflowDeps,
): Promise<void> {
  const { clock, repo } = resolveDeps(deps)
  const state = await loadState(runId, deps)
  const now = clock()

  const changes: Record<string, Channel> = {}
  for (const [name, ch] of Object.entries(state.channels)) {
    if (isNodeChannel(name, nodeName)) {
      changes[name] = { name, value: null, version: ch.version + 1, updatedAt: now }
    }
  }

  if (Object.keys(changes).length === 0) return

  const record: WorkflowRecord = {
    ...state.currentRecord,
    channelChanges: { ...state.currentRecord.channelChanges, ...changes },
  }

  await repo.appendRecord(runId, record)
}

export async function getGlobalChannel(
  key: string,
  runId: string,
  deps?: WorkflowDeps,
): Promise<Channel | null> {
  return getChannel(globalChannelName(key), runId, deps)
}

export async function setGlobalChannel(
  key: string,
  value: unknown,
  runId: string,
  deps?: WorkflowDeps,
): Promise<Channel> {
  return setChannel(globalChannelName(key), value, runId, deps)
}

// ===== Edge Channel Initialization =====

export async function initEdgeChannels(
  edges: Edge[],
  runId: string,
  deps?: WorkflowDeps,
): Promise<void> {
  const { clock, repo } = resolveDeps(deps)
  const now = clock()
  const changes: Record<string, Channel> = {}

  for (const edge of edges) {
    const name = edgeChannelName(edge.to, edge.from)
    changes[name] ??= { name, value: null, version: 0, updatedAt: now }
  }

  const records = await repo.readRecords(runId)
  if (records.length > 0) {
    records[0]!.channelChanges = { ...records[0]!.channelChanges, ...changes }
    await repo.rewriteRecords(runId, records)
  }
}

// ===== Task Lifecycle =====

export async function startTask(nodeId: string, runId: string, deps?: WorkflowDeps): Promise<Task> {
  const { clock, repo, eventRepo } = resolveDeps(deps)
  const state = await loadState(runId, deps)
  const task = findTaskInRecord(state.currentRecord, nodeId)

  if (!task) {
    throw new Error(`node '${nodeId}' not in current superstep`)
  }
  if (!canTransition(task.status, 'running')) {
    throw new Error(`task '${nodeId}' is '${task.status}', cannot start (expected 'ready')`)
  }

  const now = clock()
  task.status = 'running'
  task.startedAt = now

  const record: WorkflowRecord = {
    ...state.currentRecord,
    status: 'running' as SuperstepStatus,
  }

  await repo.appendRecord(runId, record)
  await eventRepo.appendEvent(runId, {
    timestamp: now,
    node: nodeId,
    from: 'ready',
    to: 'running',
  })
  return task
}

export async function completeTask(
  nodeId: string,
  edges: Edge[],
  runId: string,
  deps?: WorkflowDeps,
): Promise<{ task: Task; advanced: boolean }> {
  const { clock, repo, eventRepo } = resolveDeps(deps)
  const state = await loadState(runId, deps)
  const task = findTaskInRecord(state.currentRecord, nodeId)

  if (!task) {
    throw new Error(`node '${nodeId}' not in current superstep`)
  }
  if (!canTransition(task.status, 'success')) {
    throw new Error(`task '${nodeId}' is '${task.status}', cannot complete (expected 'running')`)
  }

  const now = clock()
  task.status = 'success'
  task.completedAt = now

  const edgeChanges = computeEdgeChannelUpdates(nodeId, 'success', edges, state.channels, now)

  const allTerminal = state.currentRecord.tasks.every((t) => isTerminalStatus(t.status))

  let advanced = false

  if (allTerminal) {
    const record: WorkflowRecord = {
      ...state.currentRecord,
      status: 'completed' as SuperstepStatus,
      completedAt: now,
      channelChanges: { ...state.currentRecord.channelChanges, ...edgeChanges },
    }

    await repo.appendRecord(runId, record)
    await eventRepo.appendEvent(runId, {
      timestamp: now,
      node: nodeId,
      from: 'running',
      to: 'success',
    })

    advanced = await tryAdvanceStep(runId, deps)
  } else {
    const record: WorkflowRecord = {
      ...state.currentRecord,
      channelChanges: { ...state.currentRecord.channelChanges, ...edgeChanges },
    }

    await repo.appendRecord(runId, record)
    await eventRepo.appendEvent(runId, {
      timestamp: now,
      node: nodeId,
      from: 'running',
      to: 'success',
    })
  }

  return { task, advanced }
}

export async function failTask(
  nodeId: string,
  runId: string,
  error?: string,
  deps?: WorkflowDeps,
): Promise<Task> {
  const { clock, repo, eventRepo } = resolveDeps(deps)
  const state = await loadState(runId, deps)
  const task = findTaskInRecord(state.currentRecord, nodeId)

  if (!task) {
    throw new Error(`node '${nodeId}' not in current superstep`)
  }
  if (!canTransition(task.status, 'failed')) {
    throw new Error(`task '${nodeId}' is '${task.status}', cannot fail (expected 'running')`)
  }

  const now = clock()
  task.status = 'failed'
  task.completedAt = now
  task.error = error

  const record: WorkflowRecord = {
    ...state.currentRecord,
    status: 'failed' as SuperstepStatus,
  }

  await repo.appendRecord(runId, record)
  await eventRepo.appendEvent(runId, {
    timestamp: now,
    node: nodeId,
    from: 'running',
    to: 'failed',
  })
  return task
}

export async function skipTask(
  nodeId: string,
  edges: Edge[],
  runId: string,
  deps?: WorkflowDeps,
): Promise<{ task: Task; advanced: boolean }> {
  const { clock, repo, eventRepo } = resolveDeps(deps)
  const state = await loadState(runId, deps)
  const task = findTaskInRecord(state.currentRecord, nodeId)

  if (!task) {
    throw new Error(`node '${nodeId}' not in current superstep`)
  }
  if (!canTransition(task.status, 'skipped')) {
    throw new Error(`task '${nodeId}' is '${task.status}', cannot skip`)
  }

  const fromStatus = task.status
  const now = clock()
  task.status = 'skipped'
  task.completedAt = now

  const edgeChanges = computeEdgeChannelUpdates(nodeId, 'skipped', edges, state.channels, now)

  const allTerminal = state.currentRecord.tasks.every((t) => isTerminalStatus(t.status))

  let advanced = false

  if (allTerminal) {
    const hasFailed = state.currentRecord.tasks.some((t) => t.status === 'failed')
    if (!hasFailed) {
      const record: WorkflowRecord = {
        ...state.currentRecord,
        status: 'completed' as SuperstepStatus,
        completedAt: now,
        channelChanges: { ...state.currentRecord.channelChanges, ...edgeChanges },
      }
      await repo.appendRecord(runId, record)
      await eventRepo.appendEvent(runId, {
        timestamp: now,
        node: nodeId,
        from: fromStatus,
        to: 'skipped',
      })
      advanced = await tryAdvanceStep(runId, deps)
    } else {
      const record: WorkflowRecord = {
        ...state.currentRecord,
        channelChanges: { ...state.currentRecord.channelChanges, ...edgeChanges },
      }
      await repo.appendRecord(runId, record)
      await eventRepo.appendEvent(runId, {
        timestamp: now,
        node: nodeId,
        from: fromStatus,
        to: 'skipped',
      })
    }
  } else {
    const record: WorkflowRecord = {
      ...state.currentRecord,
      channelChanges: { ...state.currentRecord.channelChanges, ...edgeChanges },
    }
    await repo.appendRecord(runId, record)
    await eventRepo.appendEvent(runId, {
      timestamp: now,
      node: nodeId,
      from: fromStatus,
      to: 'skipped',
    })
  }

  return { task, advanced }
}

export async function retryTask(nodeId: string, runId: string, deps?: WorkflowDeps): Promise<Task> {
  const { clock, repo, eventRepo } = resolveDeps(deps)
  const state = await loadState(runId, deps)
  const task = findTaskInRecord(state.currentRecord, nodeId)

  if (!task) {
    throw new Error(`node '${nodeId}' not in current superstep`)
  }
  if (!canTransition(task.status, 'ready')) {
    throw new Error(`task '${nodeId}' is '${task.status}', cannot retry (expected 'failed')`)
  }

  const now = clock()

  const changes: Record<string, Channel> = {}
  for (const [name, ch] of Object.entries(state.channels)) {
    if (isNodeChannel(name, nodeId)) {
      changes[name] = { name, value: null, version: ch.version + 1, updatedAt: now }
    }
  }

  task.status = 'ready'
  task.startedAt = undefined
  task.completedAt = undefined
  task.error = undefined

  const record: WorkflowRecord = {
    ...state.currentRecord,
    status: 'running' as SuperstepStatus,
    channelChanges: { ...state.currentRecord.channelChanges, ...changes },
  }

  await repo.appendRecord(runId, record)
  await eventRepo.appendEvent(runId, {
    timestamp: now,
    node: nodeId,
    from: 'failed',
    to: 'ready',
  })
  return task
}

export async function getTask(
  nodeId: string,
  runId: string,
  step?: number,
  deps?: WorkflowDeps,
): Promise<Task | null> {
  const { repo } = resolveDeps(deps)
  const records = await repo.readRecords(runId)
  if (records.length === 0) return null

  let record: WorkflowRecord
  if (step !== undefined) {
    record = records.find((r) => r.step === step) ?? records[records.length - 1]!
  } else {
    record = records[records.length - 1]!
  }

  return record.tasks.find((t) => t.nodeId === nodeId) ?? null
}

export async function listTasks(
  runId: string,
  step?: number,
  deps?: WorkflowDeps,
): Promise<Task[]> {
  const { repo } = resolveDeps(deps)
  const records = await repo.readRecords(runId)
  if (records.length === 0) return []

  if (step !== undefined) {
    const record = records.find((r) => r.step === step)
    return record?.tasks ?? []
  }

  return records[records.length - 1]!.tasks
}

export async function findReadyTasks(runId: string, deps?: WorkflowDeps): Promise<Task[]> {
  const state = await loadState(runId, deps)
  if (state.currentRecord.status === 'failed') return []
  return state.currentRecord.tasks.filter((t) => t.status === 'ready')
}

// ===== Superstep Control =====

function findTaskInRecord(record: WorkflowRecord, nodeId: string): Task | undefined {
  return record.tasks.find((t) => t.nodeId === nodeId)
}

export { computeTopologicalLayers }

export async function initWorkflow(
  runId: string,
  layers: Map<number, string[]>,
  edges: Edge[],
  deps?: WorkflowDeps,
): Promise<void> {
  const { clock, repo } = resolveDeps(deps)
  const now = clock()

  const edgeChanges: Record<string, Channel> = {}
  for (const edge of edges) {
    const name = edgeChannelName(edge.to, edge.from)
    edgeChanges[name] ??= { name, value: null, version: 0, updatedAt: now }
  }

  const layer0Nodes = layers.get(0) ?? []
  const tasks = layer0Nodes.map((nodeId) => createTask(nodeId, 0))

  const record: WorkflowRecord = {
    step: 0,
    status: tasks.length > 0 ? 'running' : 'completed',
    tasks,
    channelChanges: edgeChanges,
    startedAt: now,
  }

  await repo.appendRecord(runId, record)
}

async function tryAdvanceStep(runId: string, deps?: WorkflowDeps): Promise<boolean> {
  const { clock, repo, runRepo } = resolveDeps(deps)
  const runInfo = await runRepo.readRunInfo(runId)

  if (!runInfo.layerAssignment) return false

  const currentStep = runInfo.currentStep
  const nextStep = currentStep + 1

  const nextLayerNodes: string[] = []
  for (const [node, layer] of Object.entries(runInfo.layerAssignment)) {
    if (layer === nextStep) {
      nextLayerNodes.push(node)
    }
  }

  if (nextLayerNodes.length === 0) {
    runInfo.status = 'completed'
    runInfo.currentStep = currentStep
    await runRepo.writeRunInfo(runId, runInfo)
    return false
  }

  const state = await loadState(runId, deps)

  const now = clock()
  const tasks = createTasksForLayer(nextLayerNodes, nextStep, state.channels)

  const record: WorkflowRecord = {
    step: nextStep,
    status: 'running',
    tasks,
    channelChanges: {},
    startedAt: now,
  }

  await repo.appendRecord(runId, record)

  runInfo.currentStep = nextStep
  runInfo.status = 'running'
  await runRepo.writeRunInfo(runId, runInfo)

  return true
}

export { getFanoutItemsForNode }

export async function getCurrentStep(runId: string, deps?: WorkflowDeps): Promise<WorkflowRecord> {
  const state = await loadState(runId, deps)
  return state.currentRecord
}

export async function advanceStep(
  runId: string,
  _edges?: Edge[],
  deps?: WorkflowDeps,
): Promise<WorkflowRecord | null> {
  const state = await loadState(runId, deps)

  if (state.currentRecord.status !== 'completed') {
    throw new Error(
      `current superstep is '${state.currentRecord.status}', cannot advance (expected 'completed')`,
    )
  }

  const advanced = await tryAdvanceStep(runId, deps)
  if (!advanced) return null

  const newState = await loadState(runId, deps)
  return newState.currentRecord
}

export async function isStepComplete(runId: string, deps?: WorkflowDeps): Promise<boolean> {
  const state = await loadState(runId, deps)
  return state.currentRecord.status === 'completed'
}

export async function isWorkflowComplete(runId: string, deps?: WorkflowDeps): Promise<boolean> {
  const state = await loadState(runId, deps)
  return (
    state.currentRecord.status === 'completed' &&
    state.currentRecord.tasks.every((t) => t.status === 'success' || t.status === 'skipped')
  )
}

export async function getStepHistory(
  runId: string,
  deps?: WorkflowDeps,
): Promise<WorkflowRecord[]> {
  const { repo } = resolveDeps(deps)
  return repo.readRecords(runId)
}
