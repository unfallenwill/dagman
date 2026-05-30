import type { Node } from '../../shared/models/node.js'
import type { Edge, Graph } from '../../shared/models/graph.js'
import type { Task } from '../../shared/models/task.js'
import type { Channel } from '../../shared/models/channel.js'
import { condChannelName, fanoutChannelName } from '../../shared/models/channel.js'
import { loadWorkflowGraph } from '../compiler/compiler.js'
import * as runService from '../run/run-service.js'
import * as workflowService from '../workflow/workflow-engine.js'
import type { WorkflowDeps } from '../workflow/workflow-engine.js'
import type { WorkflowLoader } from '../../shared/utils/loader.js'
import type { Clock } from '../../shared/utils/clock.js'
import { buildGraphState } from '../../shared/utils/state.js'

export interface SchedulingDeps {
  loader?: WorkflowLoader
  clock?: Clock
  workflowDeps?: WorkflowDeps
  getWorkflowTsFile?: (name: string) => string
  loadGraph?: (graphName: string) => Promise<Graph>
}

let _defaults: Partial<SchedulingDeps> = {}

/** Set default deps — called by engine/composition root at startup */
export function setDefaultSchedulingDeps(defaults: Partial<SchedulingDeps>): void {
  _defaults = { ..._defaults, ...defaults }
}

function resolveSchedulingDeps(deps?: SchedulingDeps) {
  const merged = { ..._defaults, ...deps }
  return {
    loader: merged.loader!,
    getWorkflowTsFile: merged.getWorkflowTsFile!,
    workflowDeps: merged.workflowDeps,
    loadGraph: merged.loadGraph ?? loadWorkflowGraph,
  }
}

export interface NextResult {
  node: Node
  task: Task
  channels: Record<string, Channel>
}

interface RunContext {
  runId: string
  edges: Edge[]
  nodes: Node[]
  graphName: string
}

async function resolveRunContext(runId?: string, deps?: SchedulingDeps): Promise<RunContext> {
  const d = resolveSchedulingDeps(deps)
  const resolvedRunId = await runService.resolveRunId(runId)
  const graphName = await runService.getGraphForRun(resolvedRunId)
  if (!graphName) {
    throw new Error('current run is not bound to a graph, use run create --graph <name>')
  }

  const graph = await d.loadGraph(graphName)
  const nodes: Node[] = graph.nodes ?? []
  return { runId: resolvedRunId, edges: graph.edges, nodes, graphName }
}

/**
 * Filter out tasks blocked by condEdges.
 * A task is blocked if its upstream is a cond node whose channel value
 * points to a different target.
 * Filtered tasks are automatically marked as skipped.
 */
export async function filterByCondEdge(
  tasks: Task[],
  edges: Edge[],
  channels: Record<string, Channel>,
  runId: string,
  deps?: SchedulingDeps,
): Promise<Task[]> {
  const result: Task[] = []

  for (const task of tasks) {
    let blocked = false

    for (const edge of edges) {
      if (edge.from !== task.nodeId) continue

      // Check if the upstream is a cond virtual node
      const upstreamName = edge.to
      if (!upstreamName.startsWith('cond:')) continue

      // Read condEdge channel
      const condChName = condChannelName(upstreamName)
      const condChannel = channels[condChName]

      if (condChannel?.value !== task.nodeId) {
        // condEdge selected a different target → skip this task
        blocked = true
        // Auto-skip blocked tasks
        if (task.status === 'ready') {
          await workflowService.skipTask(task.nodeId, edges, runId, deps?.workflowDeps)
        }
        break
      }
    }

    if (!blocked) {
      result.push(task)
    }
  }

  return result
}

export async function findNext(runId?: string, deps?: SchedulingDeps): Promise<NextResult | null> {
  const { runId: rid, edges, nodes, graphName } = await resolveRunContext(runId, deps)
  const readyTasks = await workflowService.findReadyTasks(rid, deps?.workflowDeps)
  if (readyTasks.length === 0) return null

  const state = await workflowService.loadState(rid, deps?.workflowDeps)

  // Filter tasks blocked by condEdges
  const filtered = await filterByCondEdge(readyTasks, edges, state.channels, rid, deps)
  if (filtered.length === 0) return null

  // Pick the first by node name alphabetical order
  const sorted = [...filtered].sort((a, b) => a.nodeId.localeCompare(b.nodeId))
  const task = sorted[0]!

  const node = nodes.find((n) => n.name === task.nodeId)
  if (!node) {
    throw new Error(`node '${task.nodeId}' not found in graph`)
  }

  // Execute based on node kind
  if (node.kind === 'user') {
    await executeWorkflowNode(node, state.channels, rid, graphName, deps)
  } else if (node.kind === 'cond') {
    await executeCondEdge(node, state.channels, rid, graphName, edges, deps)
  } else if (node.kind === 'fanout') {
    await executeFanOutNode(node, state.channels, rid, graphName, edges, deps)
  }
  // collect nodes: agent handles, dagman doesn't execute

  return await buildResult(task, edges, rid, nodes, deps)
}

export async function findAllNext(runId?: string, deps?: SchedulingDeps): Promise<NextResult[]> {
  const { runId: rid, edges, nodes, graphName } = await resolveRunContext(runId, deps)
  const readyTasks = await workflowService.findReadyTasks(rid, deps?.workflowDeps)
  if (readyTasks.length === 0) return []

  const state = await workflowService.loadState(rid, deps?.workflowDeps)

  // Filter tasks blocked by condEdges
  const filtered = await filterByCondEdge(readyTasks, edges, state.channels, rid, deps)
  if (filtered.length === 0) return []

  const sorted = [...filtered].sort((a, b) => a.nodeId.localeCompare(b.nodeId))

  const results: NextResult[] = []
  for (const task of sorted) {
    const node = nodes.find((n) => n.name === task.nodeId)
    if (!node) {
      throw new Error(`node '${task.nodeId}' not found in graph`)
    }

    // Execute based on node kind
    if (node.kind === 'user') {
      await executeWorkflowNode(node, state.channels, rid, graphName, deps)
    } else if (node.kind === 'cond') {
      await executeCondEdge(node, state.channels, rid, graphName, edges, deps)
    } else if (node.kind === 'fanout') {
      await executeFanOutNode(node, state.channels, rid, graphName, edges, deps)
    }

    results.push(await buildResult(task, edges, rid, nodes, deps))
  }
  return results
}

/**
 * Execute a user-defined workflow node function via tsx import.
 * tsx imports the TS file, gets the real function object, calls it with state.
 */
async function executeWorkflowNode(
  node: Node,
  channels: Record<string, Channel>,
  runId: string,
  graphName: string,
  deps?: SchedulingDeps,
): Promise<void> {
  const d = resolveSchedulingDeps(deps)
  await workflowService.startTask(node.name, runId, d.workflowDeps)

  try {
    const tsFile = d.getWorkflowTsFile(graphName)
    const definition = await d.loader.load(tsFile)
    const nodeDef = definition.nodes.find((n) => n.name === node.name)
    if (!nodeDef) {
      throw new Error(`node '${node.name}' not found in workflow definition`)
    }

    const graphState = buildGraphState(channels)
    nodeDef.fn(graphState)

    const graph = await d.loadGraph(graphName)
    await workflowService.completeTask(node.name, graph.edges, runId, d.workflowDeps)
  } catch (err) {
    await workflowService.failTask(node.name, runId, String((err as Error).message), d.workflowDeps)
    throw err
  }
}

/**
 * Execute a conditional edge evaluation function.
 * Reads the when(state) function, determines which target node executes,
 * writes the result to the condEdge channel.
 */
async function executeCondEdge(
  node: Node,
  channels: Record<string, Channel>,
  runId: string,
  graphName: string,
  _edges: Edge[],
  deps?: SchedulingDeps,
): Promise<void> {
  const d = resolveSchedulingDeps(deps)
  await workflowService.startTask(node.name, runId, d.workflowDeps)

  try {
    const tsFile = d.getWorkflowTsFile(graphName)
    const definition = await d.loader.load(tsFile)
    const condDef = definition.condEdges.find((c) => c.nodeName === node.name)
    if (!condDef) {
      throw new Error(`condEdge '${node.name}' not found in workflow definition`)
    }

    const graphState = buildGraphState(channels)
    const targetNode = condDef.fn(graphState)

    // Write condEdge channel: value = target node name
    await workflowService.setChannel(condChannelName(node.name), targetNode, runId, d.workflowDeps)

    const graph = await d.loadGraph(graphName)
    await workflowService.completeTask(node.name, graph.edges, runId, d.workflowDeps)
  } catch (err) {
    await workflowService.failTask(node.name, runId, String((err as Error).message), d.workflowDeps)
    throw err
  }
}

/**
 * Execute a fan-out node: call fn(state) to get items array,
 * write items to _fanout channel, then complete the task.
 */
async function executeFanOutNode(
  node: Node,
  channels: Record<string, Channel>,
  runId: string,
  graphName: string,
  _edges: Edge[],
  deps?: SchedulingDeps,
): Promise<void> {
  const d = resolveSchedulingDeps(deps)
  await workflowService.startTask(node.name, runId, d.workflowDeps)

  try {
    const tsFile = d.getWorkflowTsFile(graphName)
    const definition = await d.loader.load(tsFile)
    const fanDef = definition.fanOuts.find((f) => f.nodeName === node.name)
    if (!fanDef) {
      throw new Error(`fanOut '${node.name}' not found in workflow definition`)
    }

    const graphState = buildGraphState(channels)
    const items = fanDef.fn(graphState)

    // Write fanout channel: value = items array
    await workflowService.setChannel(fanoutChannelName(node.name), items, runId, d.workflowDeps)

    const graph = await d.loadGraph(graphName)
    await workflowService.completeTask(node.name, graph.edges, runId, d.workflowDeps)
  } catch (err) {
    await workflowService.failTask(node.name, runId, String((err as Error).message), d.workflowDeps)
    throw err
  }
}

async function buildResult(
  task: Task,
  _edges: Edge[],
  runId: string,
  nodes: Node[],
  deps?: SchedulingDeps,
): Promise<NextResult> {
  const node = nodes.find((n) => n.name === task.nodeId)
  if (!node) {
    throw new Error(`node '${task.nodeId}' not found in graph`)
  }

  const state = await workflowService.loadState(runId, deps?.workflowDeps)

  return { node, task, channels: state.channels }
}
