import type { Node } from "../models/node.js";
import type { Edge } from "../models/graph.js";
import type { StateMap } from "../models/state.js";
import type { ContextData } from "../models/context.js";
import * as nodeService from "./node-service.js";
import * as stateService from "./state-service.js";
import * as contextService from "./context-service.js";
import * as graphService from "./graph-service.js";
import * as runService from "./run-service.js";
import { areDepsSatisfied, collectUpstream } from "../utils/topology.js";
import { renderTemplate } from "../utils/template.js";

export interface NextResult {
  node: Node;
  instructions: string;
  context: ContextData;
  upstreamContext: Record<string, ContextData>;
}

interface RunContext {
  runId: string;
  edges: Edge[];
  nodes: Node[];
  states: StateMap;
}

async function resolveRunContext(runId?: string): Promise<RunContext> {
  const resolvedRunId = await runService.resolveRunId(runId);
  const graphName = await runService.getGraphForRun(resolvedRunId);
  if (!graphName) {
    throw new Error("当前运行实例未绑定图，请使用 run create --graph <name>");
  }

  const graph = await graphService.loadGraph(graphName);
  const nodes = await nodeService.listNodes();
  const states = await stateService.getState(resolvedRunId);
  return { runId: resolvedRunId, edges: graph.edges, nodes, states };
}

export async function findNextNode(runId?: string): Promise<NextResult | null> {
  const { runId: rid, edges, nodes, states } = await resolveRunContext(runId);
  const sorted = [...nodes].sort((a, b) => a.name.localeCompare(b.name));

  for (const node of sorted) {
    const currentState = states[node.name];
    if (currentState !== undefined) continue;
    if (areDepsSatisfied(node.name, edges, states)) {
      return await buildResult(node, edges, rid);
    }
  }

  return null;
}

export async function findAllNextNodes(runId?: string): Promise<NextResult[]> {
  const { runId: rid, edges, nodes, states } = await resolveRunContext(runId);
  const sorted = [...nodes].sort((a, b) => a.name.localeCompare(b.name));
  const results: NextResult[] = [];

  for (const node of sorted) {
    const currentState = states[node.name];
    if (currentState !== undefined) continue;
    if (areDepsSatisfied(node.name, edges, states)) {
      results.push(await buildResult(node, edges, rid));
    }
  }

  return results;
}

async function buildResult(node: Node, edges: Edge[], runId: string): Promise<NextResult> {
  const context = await contextService.getContext(node.name, runId);
  const globalContext = await contextService.getGlobalContext(runId);
  const upstreamContext: Record<string, ContextData> = {};

  const upstream = collectUpstream(node.name, edges);
  for (const depName of upstream) {
    upstreamContext[depName] = await contextService.getContext(depName, runId);
  }

  const instructions = renderInstructions(
    node.instructions,
    context,
    globalContext,
    upstreamContext
  );

  return { node, instructions, context, upstreamContext };
}

/**
 * 渲染节点指令中的变量引用。
 * 解析优先级：self > global > upstream node
 * 缺少值时抛出错误。
 */
function renderInstructions(
  raw: string,
  selfContext: ContextData,
  globalContext: ContextData,
  upstreamContext: Record<string, ContextData>
): string {
  const { text, missing } = renderTemplate(
    raw,
    (source, key, nodeName) => {
      switch (source) {
        case "self":
          return key in selfContext ? String(selfContext[key]) : undefined;
        case "global":
          return key in globalContext ? String(globalContext[key]) : undefined;
        case "node": {
          const ctx = upstreamContext[nodeName!];
          return ctx && key in ctx ? String(ctx[key]) : undefined;
        }
      }
    }
  );

  if (missing.length > 0) {
    throw new Error(
      `节点指令中存在未解析的变量: ${missing.join(", ")}`
    );
  }

  return text;
}
