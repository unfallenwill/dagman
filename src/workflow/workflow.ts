import { promises as fs } from 'fs'
import * as path from 'path'
import type { Channel } from '../models/channel.js'
import {
  globalChannelName,
  edgeChannelName,
  isNodeChannel,
  isGlobalChannel,
  GLOBAL_CHANNEL_PREFIX,
} from '../models/channel.js'
import type { Task } from '../models/task.js'
import { createTask, isTerminalStatus } from '../models/task.js'
import type {
  WorkflowRecord,
  WorkflowState,
  SuperstepStatus,
  RunInfo,
} from '../models/superstep.js'
import type { Edge } from '../models/graph.js'
import { getWorkflowJsonlFile } from '../constants.js'
import { ensureDir } from '../utils/file.js'
import { computeTopologicalLayers } from '../utils/topology.js'
import { appendEvent } from '../runtime/event.js'
import { resolveCurrentRunId } from '../utils/run-resolver.js'

// ===== Run ID Resolution =====

async function resolveRun(runId?: string): Promise<string> {
  if (runId) return runId
  return resolveCurrentRunId()
}

// ===== JSONL Read/Write =====

async function readRecords(runId: string): Promise<WorkflowRecord[]> {
  const filePath = getWorkflowJsonlFile(runId)
  try {
    const content = await fs.readFile(path.resolve(filePath), 'utf-8')
    return content
      .trim()
      .split('\n')
      .filter((line: string) => line.length > 0)
      .map((line: string) => JSON.parse(line) as WorkflowRecord)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw err
  }
}

async function appendRecord(record: WorkflowRecord, runId: string): Promise<void> {
  const filePath = getWorkflowJsonlFile(runId)
  await ensureDir(path.dirname(path.resolve(filePath)))
  const line = JSON.stringify(record) + '\n'
  await fs.appendFile(path.resolve(filePath), line, 'utf-8')
}

// ===== State Loading =====

export async function loadState(runId?: string): Promise<WorkflowState> {
  const rid = await resolveRun(runId)
  const records = await readRecords(rid)
  if (records.length === 0) {
    throw new Error('workflow not initialized')
  }

  const channels: Record<string, Channel> = {}
  for (const record of records) {
    Object.assign(channels, record.channelChanges)
  }

  return {
    channels,
    currentRecord: records[records.length - 1]!,
  }
}

// ===== Channel Operations =====

export async function getChannel(name: string, runId?: string): Promise<Channel | null> {
  const state = await loadState(runId)
  return state.channels[name] ?? null
}

export async function getChannelVersion(name: string, runId?: string): Promise<number> {
  const ch = await getChannel(name, runId)
  return ch?.version ?? 0
}

export async function listChannels(nodeName?: string, runId?: string): Promise<Channel[]> {
  const state = await loadState(runId)
  const all = Object.values(state.channels)
  if (!nodeName) return all

  if (nodeName === GLOBAL_CHANNEL_PREFIX) {
    return all.filter((ch) => isGlobalChannel(ch.name))
  }
  return all.filter((ch) => isNodeChannel(ch.name, nodeName))
}

export async function setChannel(name: string, value: unknown, runId?: string): Promise<Channel> {
  const rid = await resolveRun(runId)
  const state = await loadState(rid)
  const existing = state.channels[name]
  const now = new Date().toISOString()

  const channel: Channel = {
    name,
    value,
    version: (existing?.version ?? 0) + 1,
    updatedAt: now,
  }

  // Update current record's channelChanges and append
  const record: WorkflowRecord = {
    ...state.currentRecord,
    channelChanges: {
      ...state.currentRecord.channelChanges,
      [name]: channel,
    },
  }

  await appendRecord(record, rid)
  return channel
}

export async function clearChannels(nodeName: string, runId?: string): Promise<void> {
  const rid = await resolveRun(runId)
  const state = await loadState(rid)
  const now = new Date().toISOString()

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

  await appendRecord(record, rid)
}

export async function getGlobalChannel(key: string, runId?: string): Promise<Channel | null> {
  return getChannel(globalChannelName(key), runId)
}

export async function setGlobalChannel(
  key: string,
  value: unknown,
  runId?: string,
): Promise<Channel> {
  return setChannel(globalChannelName(key), value, runId)
}

// ===== Edge Channel Initialization =====

export async function initEdgeChannels(edges: Edge[], runId: string): Promise<void> {
  const now = new Date().toISOString()
  const changes: Record<string, Channel> = {}

  for (const edge of edges) {
    const name = edgeChannelName(edge.to, edge.from)
    changes[name] ??= { name, value: null, version: 0, updatedAt: now }
  }

  // Edge channels are written when the first record is initialized
  const records = await readRecords(runId)
  if (records.length > 0) {
    records[0]!.channelChanges = { ...records[0]!.channelChanges, ...changes }
    // Rewrite the entire file
    const filePath = getWorkflowJsonlFile(runId)
    const content = records.map((r) => JSON.stringify(r)).join('\n') + '\n'
    await fs.writeFile(path.resolve(filePath), content, 'utf-8')
  }
}

function updateEdgeChannelsForNode(
  nodeId: string,
  taskStatus: string,
  edges: Edge[],
  existingChannels: Record<string, Channel>,
): Record<string, Channel> {
  const now = new Date().toISOString()
  const changes: Record<string, Channel> = {}

  for (const edge of edges) {
    if (edge.to === nodeId) {
      const name = edgeChannelName(edge.to, edge.from)
      const existing = existingChannels[name]
      changes[name] = {
        name,
        value: taskStatus,
        version: (existing?.version ?? 0) + 1,
        updatedAt: now,
      }
    }
  }

  return changes
}

// ===== Task Lifecycle =====

export async function startTask(nodeId: string, runId?: string): Promise<Task> {
  const rid = await resolveRun(runId)
  const state = await loadState(rid)
  const task = findTaskInRecord(state.currentRecord, nodeId)

  if (!task) {
    throw new Error(`node '${nodeId}' not in current superstep`)
  }
  if (task.status !== 'ready') {
    throw new Error(`task '${nodeId}' is '${task.status}', cannot start (expected 'ready')`)
  }

  const now = new Date().toISOString()
  task.status = 'running'
  task.startedAt = now

  const record: WorkflowRecord = {
    ...state.currentRecord,
    status: 'running' as SuperstepStatus,
  }

  await appendRecord(record, rid)
  await appendEvent(nodeId, 'ready', 'running', rid)
  return task
}

export async function completeTask(
  nodeId: string,
  edges: Edge[],
  runId?: string,
): Promise<{ task: Task; advanced: boolean }> {
  const rid = await resolveRun(runId)
  const state = await loadState(rid)
  const task = findTaskInRecord(state.currentRecord, nodeId)

  if (!task) {
    throw new Error(`node '${nodeId}' not in current superstep`)
  }
  if (task.status !== 'running') {
    throw new Error(`task '${nodeId}' is '${task.status}', cannot complete (expected 'running')`)
  }

  const now = new Date().toISOString()
  task.status = 'success'
  task.completedAt = now

  // Update edge channels
  const edgeChanges = updateEdgeChannelsForNode(nodeId, 'success', edges, state.channels)

  // Check if superstep is complete
  const allTerminal = state.currentRecord.tasks.every((t) => isTerminalStatus(t.status))

  let advanced = false

  if (allTerminal) {
    // Superstep complete: collect all channelChanges, take snapshot
    const record: WorkflowRecord = {
      ...state.currentRecord,
      status: 'completed' as SuperstepStatus,
      completedAt: now,
      channelChanges: { ...state.currentRecord.channelChanges, ...edgeChanges },
    }

    await appendRecord(record, rid)
    await appendEvent(nodeId, 'running', 'success', rid)

    // Auto-advance to next layer
    advanced = await tryAdvanceStep(rid)
  } else {
    // Still has incomplete tasks
    const record: WorkflowRecord = {
      ...state.currentRecord,
      channelChanges: { ...state.currentRecord.channelChanges, ...edgeChanges },
    }

    await appendRecord(record, rid)
    await appendEvent(nodeId, 'running', 'success', rid)
  }

  return { task, advanced }
}

export async function failTask(nodeId: string, error?: string, runId?: string): Promise<Task> {
  const rid = await resolveRun(runId)
  const state = await loadState(rid)
  const task = findTaskInRecord(state.currentRecord, nodeId)

  if (!task) {
    throw new Error(`node '${nodeId}' not in current superstep`)
  }
  if (task.status !== 'running') {
    throw new Error(`task '${nodeId}' is '${task.status}', cannot fail (expected 'running')`)
  }

  const now = new Date().toISOString()
  task.status = 'failed'
  task.completedAt = now
  task.error = error

  const record: WorkflowRecord = {
    ...state.currentRecord,
    status: 'failed' as SuperstepStatus,
  }

  await appendRecord(record, rid)
  await appendEvent(nodeId, 'running', 'failed', rid)
  return task
}

export async function skipTask(
  nodeId: string,
  edges: Edge[],
  runId?: string,
): Promise<{ task: Task; advanced: boolean }> {
  const rid = await resolveRun(runId)
  const state = await loadState(rid)
  const task = findTaskInRecord(state.currentRecord, nodeId)

  if (!task) {
    throw new Error(`node '${nodeId}' not in current superstep`)
  }
  if (task.status !== 'ready' && task.status !== 'running') {
    throw new Error(`task '${nodeId}' is '${task.status}', cannot skip`)
  }

  const fromStatus = task.status
  const now = new Date().toISOString()
  task.status = 'skipped'
  task.completedAt = now

  // Update edge channels
  const edgeChanges = updateEdgeChannelsForNode(nodeId, 'skipped', edges, state.channels)

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
      await appendRecord(record, rid)
      await appendEvent(nodeId, fromStatus, 'skipped', rid)
      advanced = await tryAdvanceStep(rid)
    } else {
      // Still has failed tasks, remain paused
      const record: WorkflowRecord = {
        ...state.currentRecord,
        channelChanges: { ...state.currentRecord.channelChanges, ...edgeChanges },
      }
      await appendRecord(record, rid)
      await appendEvent(nodeId, fromStatus, 'skipped', rid)
    }
  } else {
    const record: WorkflowRecord = {
      ...state.currentRecord,
      channelChanges: { ...state.currentRecord.channelChanges, ...edgeChanges },
    }
    await appendRecord(record, rid)
    await appendEvent(nodeId, fromStatus, 'skipped', rid)
  }

  return { task, advanced }
}

export async function retryTask(nodeId: string, runId?: string): Promise<Task> {
  const rid = await resolveRun(runId)
  const state = await loadState(rid)
  const task = findTaskInRecord(state.currentRecord, nodeId)

  if (!task) {
    throw new Error(`node '${nodeId}' not in current superstep`)
  }
  if (task.status !== 'failed') {
    throw new Error(`task '${nodeId}' is '${task.status}', cannot retry (expected 'failed')`)
  }

  const now = new Date().toISOString()

  // Clear output channels for this task
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

  await appendRecord(record, rid)
  await appendEvent(nodeId, 'failed', 'ready', rid)
  return task
}

export async function getTask(nodeId: string, step?: number, runId?: string): Promise<Task | null> {
  const rid = await resolveRun(runId)
  const records = await readRecords(rid)
  if (records.length === 0) return null

  // Find latest record
  let record: WorkflowRecord
  if (step !== undefined) {
    record = records.find((r) => r.step === step) ?? records[records.length - 1]!
  } else {
    record = records[records.length - 1]!
  }

  return record.tasks.find((t) => t.nodeId === nodeId) ?? null
}

export async function listTasks(step?: number, runId?: string): Promise<Task[]> {
  const rid = await resolveRun(runId)
  const records = await readRecords(rid)
  if (records.length === 0) return []

  if (step !== undefined) {
    const record = records.find((r) => r.step === step)
    return record?.tasks ?? []
  }

  return records[records.length - 1]!.tasks
}

export async function findReadyTasks(runId?: string): Promise<Task[]> {
  const state = await loadState(runId)
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
): Promise<void> {
  const now = new Date().toISOString()

  // Initialize edge channels
  const edgeChanges: Record<string, Channel> = {}
  for (const edge of edges) {
    const name = edgeChannelName(edge.to, edge.from)
    edgeChanges[name] ??= { name, value: null, version: 0, updatedAt: now }
  }

  // Create tasks for Layer 0
  const layer0Nodes = layers.get(0) ?? []
  const tasks = layer0Nodes.map((nodeId) => createTask(nodeId, 0))

  const record: WorkflowRecord = {
    step: 0,
    status: tasks.length > 0 ? 'running' : 'completed',
    tasks,
    channelChanges: edgeChanges,
    startedAt: now,
  }

  await appendRecord(record, runId)
}

async function tryAdvanceStep(runId: string): Promise<boolean> {
  const { readJSON, writeJSON } = await import('../utils/file.js')
  const { getRunMetaFile } = await import('../constants.js')
  const runInfo: RunInfo = await readJSON(getRunMetaFile(runId))

  if (!runInfo.layerAssignment) return false

  const currentStep = runInfo.currentStep
  const nextStep = currentStep + 1

  // Find nodes in the next layer
  const nextLayerNodes: string[] = []
  for (const [node, layer] of Object.entries(runInfo.layerAssignment)) {
    if (layer === nextStep) {
      nextLayerNodes.push(node)
    }
  }

  if (nextLayerNodes.length === 0) {
    // Workflow complete
    runInfo.status = 'completed'
    runInfo.currentStep = currentStep
    await writeJSON(getRunMetaFile(runId), runInfo)
    return false
  }

  // Load current state to read fanout channels
  const state = await loadState(runId)

  // Create tasks, expanding fanout template nodes into dynamic tasks
  const now = new Date().toISOString()
  const tasks: Task[] = []

  for (const nodeId of nextLayerNodes) {
    // Check if this node is a fanout template node by looking for upstream fanout channels
    const fanoutItems = await getFanoutItemsForNode(nodeId, state.channels)

    if (fanoutItems && fanoutItems.length > 0) {
      // Dynamic task creation: one task per item
      for (let i = 0; i < fanoutItems.length; i++) {
        tasks.push({
          ...createTask(nodeId, nextStep, 'dynamic'),
          id: `${nodeId}#${i}@step${nextStep}`,
          fanOutIndex: i,
          fanOutParam: fanoutItems[i],
        })
      }
    } else {
      // Normal task
      tasks.push(createTask(nodeId, nextStep))
    }
  }

  const record: WorkflowRecord = {
    step: nextStep,
    status: 'running',
    tasks,
    channelChanges: {},
    startedAt: now,
  }

  await appendRecord(record, runId)

  // Update run.json
  runInfo.currentStep = nextStep
  runInfo.status = 'running'
  await writeJSON(getRunMetaFile(runId), runInfo)

  return true
}

/**
 * Check if a node is the template target of a fanout, and return the items.
 * Returns null if this node is not a fanout template.
 */
export async function getFanoutItemsForNode(
  nodeId: string,
  channels: Record<string, Channel>,
): Promise<any[] | null> {
  // Look through all channels for fanout channels that target this node
  for (const [name, ch] of Object.entries(channels)) {
    if (!name.startsWith('_fanout.')) continue
    // The fanout channel name encodes the template: fanout:<from>→<templateNode>
    const fanoutNodeName = name.slice('_fanout.'.length)
    // Check if the templateNode part matches nodeId
    const arrowIndex = fanoutNodeName.indexOf('→')
    if (arrowIndex === -1) continue
    const templateNode = fanoutNodeName.slice(arrowIndex + '→'.length)
    if (templateNode === nodeId && Array.isArray(ch.value)) {
      return ch.value as any[]
    }
  }
  return null
}

export async function getCurrentStep(runId?: string): Promise<WorkflowRecord> {
  const state = await loadState(runId)
  return state.currentRecord
}

export async function advanceStep(runId?: string, _edges?: Edge[]): Promise<WorkflowRecord | null> {
  const rid = await resolveRun(runId)
  const state = await loadState(rid)

  if (state.currentRecord.status !== 'completed') {
    throw new Error(
      `current superstep is '${state.currentRecord.status}', cannot advance (expected 'completed')`,
    )
  }

  const advanced = await tryAdvanceStep(rid)
  if (!advanced) return null

  const newState = await loadState(rid)
  return newState.currentRecord
}

export async function isStepComplete(runId?: string): Promise<boolean> {
  const state = await loadState(runId)
  return state.currentRecord.status === 'completed'
}

export async function isWorkflowComplete(runId?: string): Promise<boolean> {
  const state = await loadState(runId)
  return (
    state.currentRecord.status === 'completed' &&
    state.currentRecord.tasks.every((t) => t.status === 'success' || t.status === 'skipped')
  )
}

export async function getStepHistory(runId?: string): Promise<WorkflowRecord[]> {
  const rid = await resolveRun(runId)
  return readRecords(rid)
}
