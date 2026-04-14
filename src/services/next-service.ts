import type { Node } from "../models/node.js";
import { normalizeDependency } from "../models/node.js";
import type { StateMap } from "../models/state.js";
import type { ContextData } from "../models/context.js";
import * as nodeService from "./node-service.js";
import * as stateService from "./state-service.js";
import * as contextService from "./context-service.js";

export interface NextResult {
  node: Node;
  context: ContextData;
  upstreamContext: Record<string, ContextData>;
}

function areDependenciesSatisfied(
  node: Node,
  states: StateMap
): boolean {
  if (node.depends_on.length === 0) return true;

  return node.depends_on.every((dep) => {
    const norm = normalizeDependency(dep);
    const depState = states[norm.node];
    return depState === norm.status;
  });
}

export async function findNextNode(runId?: string): Promise<NextResult | null> {
  const nodes = await nodeService.listNodes();
  const states = await stateService.getState(runId);

  const sorted = [...nodes].sort((a, b) => a.name.localeCompare(b.name));

  for (const node of sorted) {
    const currentState = states[node.name];

    // 有状态记录：节点已处理，跳过
    if (currentState !== undefined) {
      continue;
    }

    // 无状态记录且依赖满足：下一个可执行节点
    if (areDependenciesSatisfied(node, states)) {
      return await buildResult(node, runId);
    }
  }

  return null;
}

async function buildResult(node: Node, runId?: string): Promise<NextResult> {
  const context = await contextService.getContext(node.name, runId);
  const upstreamContext: Record<string, ContextData> = {};

  for (const dep of node.depends_on) {
    const norm = normalizeDependency(dep);
    upstreamContext[norm.node] = await contextService.getContext(norm.node, runId);
  }

  return { node, context, upstreamContext };
}
