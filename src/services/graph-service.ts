import type { Node } from "../models/node.js";
import { normalizeDependency } from "../models/node.js";
import type { StateMap } from "../models/state.js";
import * as nodeService from "./node-service.js";
import * as stateService from "./state-service.js";

export async function buildGraph(): Promise<{
  nodes: Node[];
  states: StateMap;
}> {
  const nodes = await nodeService.listNodes();
  const states = await stateService.getState();
  return { nodes, states };
}

export function formatGraph(nodes: Node[], states: StateMap): string {
  if (nodes.length === 0) {
    return "暂无已注册节点";
  }

  const sorted = [...nodes].sort((a, b) => a.name.localeCompare(b.name));

  return sorted
    .map((node) => {
      const status = states[node.name] ?? node.default_state;
      const deps = node.depends_on
        .map((dep) => {
          const norm = normalizeDependency(dep);
          return `${norm.node}:${norm.status}`;
        })
        .join(", ");

      if (deps) {
        return `${node.name} [${status}] -> ${deps}`;
      }
      return `${node.name} [${status}]`;
    })
    .join("\n");
}
