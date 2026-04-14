import type { Node } from "../models/node.js";
import { normalizeDependency } from "../models/node.js";
import type { StateMap } from "../models/state.js";
import { DEFAULT_STATE } from "../models/state.js";
import * as nodeService from "./node-service.js";
import * as stateService from "./state-service.js";
import * as eventService from "./event-service.js";

export async function buildGraph(runId?: string): Promise<{
  nodes: Node[];
  states: StateMap;
  timestamps: Record<string, string>;
}> {
  const nodes = await nodeService.listNodes();
  const states = await stateService.getState(runId);
  const timestamps = await eventService.getNodeTimestamps(runId);
  return { nodes, states, timestamps };
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatGraph(
  nodes: Node[],
  states: StateMap,
  timestamps?: Record<string, string>
): string {
  if (nodes.length === 0) {
    return "暂无已注册节点";
  }

  const ts = timestamps ?? {};
  const sorted = [...nodes].sort((a, b) => a.name.localeCompare(b.name));

  return sorted
    .map((node) => {
      const status = states[node.name] ?? DEFAULT_STATE;
      const statusDisplay = ts[node.name]
        ? `${status} ${formatTimestamp(ts[node.name])}`
        : status;
      const deps = node.depends_on
        .map((dep) => {
          const norm = normalizeDependency(dep);
          return `${norm.node}:${norm.status}`;
        })
        .join(", ");

      if (deps) {
        return `${node.name} [${statusDisplay}] -> ${deps}`;
      }
      return `${node.name} [${statusDisplay}]`;
    })
    .join("\n");
}
