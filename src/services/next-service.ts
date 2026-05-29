import type { Node } from "../models/node.js";
import type { Edge } from "../models/graph.js";
import type { Task } from "../models/task.js";
import type { Channel } from "../models/channel.js";
import * as nodeService from "./node-service.js";
import * as graphService from "./graph-service.js";
import * as runService from "./run-service.js";
import * as workflowService from "./workflow-service.js";
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
    throw new Error("当前运行实例未绑定图，请使用 run create --graph <name>");
  }

  const graph = await graphService.loadGraph(graphName);
  return { runId: resolvedRunId, edges: graph.edges };
}

export async function findNext(runId?: string): Promise<NextResult | null> {
  const { runId: rid, edges } = await resolveRunContext(runId);
  const readyTasks = await workflowService.findReadyTasks(rid);
  if (readyTasks.length === 0) return null;

  // 按节点名字母序取第一个
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
 * 从 workflow channels 渲染节点指令中的变量引用。
 * {{key}} → channel {currentNode}.{key}
 * {{global.key}} → channel _global.{key}
 * {{node-name.key}} → channel {node-name}.{key}
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
      // version = 0 视为从未写入（缺失）
      if (!ch || ch.version === 0) return undefined;
      return String(ch.value);
    }
  );

  if (missing.length > 0) {
    throw new Error(
      `节点指令中存在未解析的变量: ${missing.join(", ")}`
    );
  }

  return text;
}
