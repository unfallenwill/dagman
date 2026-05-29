import * as path from "path";
import type { Node } from "../models/node.js";
import type { Edge } from "../models/graph.js";
import type { Task } from "../models/task.js";
import type { Channel } from "../models/channel.js";
import { condChannelName, fanoutChannelName, nodeChannelName, globalChannelName } from "../models/channel.js";
import * as graphService from "../graph/graph.js";
import * as runService from "../runtime/run.js";
import * as workflowService from "../workflow/workflow.js";
import { getWorkflowTsFile } from "../constants.js";
import { buildGraphState } from "../utils/state.js";
import { renderTemplate } from "../utils/template.js";

export interface NextResult {
  node: Node;
  task: Task;
  instructions: string;
  channels: Record<string, Channel>;
}

interface RunContext {
  runId: string;
  edges: Edge[];
  nodes: Node[];
  graphName: string;
}

async function resolveRunContext(runId?: string): Promise<RunContext> {
  const resolvedRunId = await runService.resolveRunId(runId);
  const graphName = await runService.getGraphForRun(resolvedRunId);
  if (!graphName) {
    throw new Error("current run is not bound to a graph, use run create --graph <name>");
  }

  // Try compiled JSON graph first (from TS workflow), fall back to YAML
  let graph;
  try {
    graph = await graphService.loadCompiledGraph(graphName);
  } catch {
    graph = await graphService.loadGraph(graphName);
  }
  const nodes: Node[] = graph.nodes ?? [];
  return { runId: resolvedRunId, edges: graph.edges, nodes, graphName };
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
): Promise<Task[]> {
  const result: Task[] = [];

  for (const task of tasks) {
    let blocked = false;

    for (const edge of edges) {
      if (edge.from !== task.nodeId) continue;

      // Check if the upstream is a cond virtual node
      const upstreamName = edge.to;
      if (!upstreamName.startsWith("cond:")) continue;

      // Read condEdge channel
      const condChName = condChannelName(upstreamName);
      const condChannel = channels[condChName];

      if (!condChannel || condChannel.value !== task.nodeId) {
        // condEdge selected a different target → skip this task
        blocked = true;
        // Auto-skip blocked tasks
        if (task.status === "ready") {
          await workflowService.skipTask(task.nodeId, edges, runId);
        }
        break;
      }
    }

    if (!blocked) {
      result.push(task);
    }
  }

  return result;
}

export async function findNext(runId?: string): Promise<NextResult | null> {
  const { runId: rid, edges, nodes, graphName } = await resolveRunContext(runId);
  const readyTasks = await workflowService.findReadyTasks(rid);
  if (readyTasks.length === 0) return null;

  const state = await workflowService.loadState(rid);

  // Filter tasks blocked by condEdges
  const filtered = await filterByCondEdge(readyTasks, edges, state.channels, rid);
  if (filtered.length === 0) return null;

  // Pick the first by node name alphabetical order
  const sorted = [...filtered].sort((a, b) =>
    a.nodeId.localeCompare(b.nodeId)
  );
  const task = sorted[0];

  const node = nodes.find(n => n.name === task.nodeId);
  if (!node) {
    throw new Error(`node '${task.nodeId}' not found in graph`);
  }

  // Execute based on node kind
  if (node.kind === "user") {
    await executeWorkflowNode(node, state.channels, rid, graphName);
  } else if (node.kind === "cond") {
    await executeCondEdge(node, state.channels, rid, graphName, edges);
  } else if (node.kind === "fanout") {
    await executeFanOutNode(node, state.channels, rid, graphName, edges);
  }
  // collect nodes: agent handles, dagman doesn't execute

  return await buildResult(task, edges, rid, nodes);
}

export async function findAllNext(runId?: string): Promise<NextResult[]> {
  const { runId: rid, edges, nodes, graphName } = await resolveRunContext(runId);
  const readyTasks = await workflowService.findReadyTasks(rid);
  if (readyTasks.length === 0) return [];

  const state = await workflowService.loadState(rid);

  // Filter tasks blocked by condEdges
  const filtered = await filterByCondEdge(readyTasks, edges, state.channels, rid);
  if (filtered.length === 0) return [];

  const sorted = [...filtered].sort((a, b) =>
    a.nodeId.localeCompare(b.nodeId)
  );

  const results: NextResult[] = [];
  for (const task of sorted) {
    const node = nodes.find(n => n.name === task.nodeId);
    if (!node) {
      throw new Error(`node '${task.nodeId}' not found in graph`);
    }

    // Execute based on node kind
    if (node.kind === "user") {
      await executeWorkflowNode(node, state.channels, rid, graphName);
    } else if (node.kind === "cond") {
      await executeCondEdge(node, state.channels, rid, graphName, edges);
    } else if (node.kind === "fanout") {
      await executeFanOutNode(node, state.channels, rid, graphName, edges);
    }

    results.push(await buildResult(task, edges, rid, nodes));
  }
  return results;
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
): Promise<void> {
  await workflowService.startTask(node.name, runId);

  try {
    const definition = await importWorkflowDefinition(graphName);
    const nodeDef = definition.nodes.find((n) => n.name === node.name);
    if (!nodeDef) {
      throw new Error(`node '${node.name}' not found in workflow definition`);
    }

    const graphState = buildGraphState(channels);
    nodeDef.fn(graphState);

    const graph = await loadGraphForRun(graphName);
    await workflowService.completeTask(node.name, graph.edges, runId);
  } catch (err) {
    await workflowService.failTask(node.name, String((err as Error).message), runId);
    throw err;
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
  edges: Edge[],
): Promise<void> {
  await workflowService.startTask(node.name, runId);

  try {
    const definition = await importWorkflowDefinition(graphName);
    const condDef = definition.condEdges.find((c) => c.nodeName === node.name);
    if (!condDef) {
      throw new Error(`condEdge '${node.name}' not found in workflow definition`);
    }

    const graphState = buildGraphState(channels);
    const targetNode = condDef.fn(graphState);

    // Write condEdge channel: value = target node name
    await workflowService.setChannel(
      condChannelName(node.name),
      targetNode,
      runId,
    );

    const graph = await loadGraphForRun(graphName);
    await workflowService.completeTask(node.name, graph.edges, runId);
  } catch (err) {
    await workflowService.failTask(node.name, String((err as Error).message), runId);
    throw err;
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
  edges: Edge[],
): Promise<void> {
  await workflowService.startTask(node.name, runId);

  try {
    const definition = await importWorkflowDefinition(graphName);
    const fanDef = definition.fanOuts?.find((f) => f.nodeName === node.name);
    if (!fanDef) {
      throw new Error(`fanOut '${node.name}' not found in workflow definition`);
    }

    const graphState = buildGraphState(channels);
    const items = fanDef.fn(graphState);

    // Write fanout channel: value = items array
    await workflowService.setChannel(
      fanoutChannelName(node.name),
      items,
      runId,
    );

    const graph = await loadGraphForRun(graphName);
    await workflowService.completeTask(node.name, graph.edges, runId);
  } catch (err) {
    await workflowService.failTask(node.name, String((err as Error).message), runId);
    throw err;
  }
}

/**
 * tsx dynamic import the TS workflow file and get the WorkflowDefinition.
 */
async function importWorkflowDefinition(graphName: string) {
  const tsFile = getWorkflowTsFile(graphName);
  const absPath = path.resolve(tsFile);

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { register } = require("tsx/esm") as { register: () => void };
    register();
  } catch {
    // tsx may already be registered
  }

  // Bust cache for repeated imports during development
  const timestamp = Date.now();
  const mod = await import(`${absPath}?t=${timestamp}`);

  if (!mod.default || typeof mod.default !== "object") {
    throw new Error("workflow file must export a default WorkflowDefinition");
  }

  return mod.default as import("../models/workflow-def.js").WorkflowDefinition;
}

/**
 * Load graph for a run, trying compiled JSON first then YAML.
 */
async function loadGraphForRun(graphName: string): Promise<{ edges: Edge[] }> {
  try {
    return await graphService.loadCompiledGraph(graphName);
  } catch {
    return await graphService.loadGraph(graphName);
  }
}

async function buildResult(
  task: Task,
  edges: Edge[],
  runId: string,
  nodes: Node[]
): Promise<NextResult> {
  const node = nodes.find(n => n.name === task.nodeId);
  if (!node) {
    throw new Error(`node '${task.nodeId}' not found in graph`);
  }

  const state = await workflowService.loadState(runId);

  const instructions = renderInstructions(
    node.instructions,
    task.nodeId,
    edges,
    state.channels
  );

  return { node, task, instructions, channels: state.channels };
}

/**
 * Render variable references in node instructions from workflow channels.
 * {{key}} -> channel {currentNode}.{key}
 * {{global.key}} -> channel _global.{key}
 * {{node-name.key}} -> channel {node-name}.{key}
 */
function renderInstructions(
  raw: string,
  currentNode: string,
  edges: Edge[],
  channels: Record<string, Channel>
): string {
  const { text, missing } = renderTemplate(
    raw,
    (source, key, nodeName) => {
      let channelName: string;
      switch (source) {
        case "self":
          channelName = nodeChannelName(currentNode, key);
          break;
        case "global":
          channelName = globalChannelName(key);
          break;
        case "node":
          channelName = nodeChannelName(nodeName!, key);
          break;
      }

      const ch = channels[channelName];
      // version = 0 means never written (missing)
      if (!ch || ch.version === 0) return undefined;
      return String(ch.value);
    }
  );

  if (missing.length > 0) {
    throw new Error(
      `unresolved variables in node instructions: ${missing.join(", ")}`
    );
  }

  return text;
}
