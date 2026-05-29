import type { Node } from "../models/node.js";
import type { Edge } from "../models/graph.js";
import type { Task } from "../models/task.js";
import type { Channel } from "../models/channel.js";
import * as nodeService from "../graph/node.js";
import * as graphService from "../graph/graph.js";
import * as runService from "../runtime/run.js";
import * as workflowService from "../workflow/workflow.js";
import { nodeChannelName, globalChannelName } from "../models/channel.js";
import { collectUpstream } from "../utils/topology.js";
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
}

async function resolveRunContext(runId?: string): Promise<RunContext> {
  const resolvedRunId = await runService.resolveRunId(runId);
  const graphName = await runService.getGraphForRun(resolvedRunId);
  if (!graphName) {
    throw new Error("current run is not bound to a graph, use run create --graph <name>");
  }

  const graph = await graphService.loadGraph(graphName);
  return { runId: resolvedRunId, edges: graph.edges };
}

export async function findNext(runId?: string): Promise<NextResult | null> {
  const { runId: rid, edges } = await resolveRunContext(runId);
  const readyTasks = await workflowService.findReadyTasks(rid);
  if (readyTasks.length === 0) return null;

  // Pick the first by node name alphabetical order
  const sorted = [...readyTasks].sort((a, b) =>
    a.nodeId.localeCompare(b.nodeId)
  );
  const task = sorted[0];
  return await buildResult(task, edges, rid);
}

export async function findAllNext(runId?: string): Promise<NextResult[]> {
  const { runId: rid, edges } = await resolveRunContext(runId);
  const readyTasks = await workflowService.findReadyTasks(rid);

  const sorted = [...readyTasks].sort((a, b) =>
    a.nodeId.localeCompare(b.nodeId)
  );

  const results: NextResult[] = [];
  for (const task of sorted) {
    results.push(await buildResult(task, edges, rid));
  }
  return results;
}

async function buildResult(
  task: Task,
  edges: Edge[],
  runId: string
): Promise<NextResult> {
  const node = await nodeService.getNode(task.nodeId);
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
