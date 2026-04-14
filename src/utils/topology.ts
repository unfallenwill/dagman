import type { Edge } from "../models/graph.js";
import type { StateMap } from "../models/state.js";

/**
 * 构建正向邻接表：from -> [to, ...]
 * 表示依赖方向：from 依赖于 to
 */
export function buildAdjacencyMap(edges: Edge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    const neighbors = adj.get(edge.from) ?? [];
    neighbors.push(edge.to);
    adj.set(edge.from, neighbors);
  }
  return adj;
}

/**
 * 构建反向邻接表：to -> [from, ...]
 * 表示影响方向：谁依赖于 to
 */
export function buildReverseAdjacencyMap(edges: Edge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    const neighbors = adj.get(edge.to) ?? [];
    neighbors.push(edge.from);
    adj.set(edge.to, neighbors);
  }
  return adj;
}

/**
 * 检测边列表中是否存在循环依赖（DFS 三色标记）。
 */
export function hasCycle(edges: Edge[]): boolean {
  const adj = buildAdjacencyMap(edges);
  const allNodes = new Set<string>();
  for (const edge of edges) {
    allNodes.add(edge.from);
    allNodes.add(edge.to);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const node of allNodes) {
    color.set(node, WHITE);
  }

  function dfs(node: string): boolean {
    color.set(node, GRAY);
    const neighbors = adj.get(node) ?? [];
    for (const neighbor of neighbors) {
      if (!color.has(neighbor)) continue;
      const c = color.get(neighbor)!;
      if (c === GRAY) return true;
      if (c === WHITE && dfs(neighbor)) return true;
    }
    color.set(node, BLACK);
    return false;
  }

  for (const node of allNodes) {
    if (color.get(node) === WHITE) {
      if (dfs(node)) return true;
    }
  }

  return false;
}

/**
 * 检查节点的所有依赖是否满足。
 * 边语义：from 依赖于 to，所以 nodeName 的依赖是 edges[from === nodeName]。
 * expect 默认为 "success"，skipped 等价于 success。
 */
export function areDepsSatisfied(
  nodeName: string,
  edges: Edge[],
  states: StateMap
): boolean {
  const deps = edges.filter((e) => e.from === nodeName);
  if (deps.length === 0) return true;

  return deps.every((edge) => {
    const expect = edge.expect ?? "success";
    const depState = states[edge.to];
    if (depState === expect) return true;
    // skipped 等价于 success
    if (expect === "success" && depState === "skipped") return true;
    return false;
  });
}

/**
 * 收集节点的直接上游节点名称（被依赖的节点）。
 * from 依赖于 to，所以 nodeName 的上游是 edges[from === nodeName] 的 to 值。
 */
export function collectUpstream(nodeName: string, edges: Edge[]): string[] {
  return edges.filter((e) => e.from === nodeName).map((e) => e.to);
}

/**
 * 收集节点的直接下游节点名称（依赖于该节点的节点）。
 * to 被依赖，所以 nodeName 的下游是 edges[to === nodeName] 的 from 值。
 */
export function collectDownstream(nodeName: string, edges: Edge[]): string[] {
  return edges.filter((e) => e.to === nodeName).map((e) => e.from);
}

/**
 * 找到边中引用了不存在节点的目标。
 */
export function findMissingTargets(
  edges: Edge[],
  nodeNames: Set<string>
): { edge: Edge; side: "from" | "to" }[] {
  const missing: { edge: Edge; side: "from" | "to" }[] = [];
  for (const edge of edges) {
    if (!nodeNames.has(edge.from)) missing.push({ edge, side: "from" });
    if (!nodeNames.has(edge.to)) missing.push({ edge, side: "to" });
  }
  return missing;
}

/**
 * 找到孤立节点（没有任何边连接）。
 */
export function findOrphanNodes(
  edges: Edge[],
  nodeNames: Set<string>
): string[] {
  const connected = new Set<string>();
  for (const edge of edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  return [...nodeNames].filter((name) => !connected.has(name));
}

/**
 * 找到循环路径（用于错误信息）。
 */
export function findCyclePaths(edges: Edge[]): string[][] {
  const adj = buildAdjacencyMap(edges);
  const allNodes = new Set<string>();
  for (const edge of edges) {
    allNodes.add(edge.from);
    allNodes.add(edge.to);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const node of allNodes) {
    color.set(node, WHITE);
  }

  const cycles: string[][] = [];
  const path: string[] = [];

  function dfs(node: string): boolean {
    color.set(node, GRAY);
    path.push(node);

    const neighbors = adj.get(node) ?? [];
    for (const neighbor of neighbors) {
      if (!color.has(neighbor)) continue;
      const c = color.get(neighbor)!;
      if (c === GRAY) {
        const cycleStart = path.indexOf(neighbor);
        cycles.push(path.slice(cycleStart));
        path.pop();
        color.set(node, BLACK);
        return true;
      }
      if (c === WHITE && dfs(neighbor)) {
        path.pop();
        color.set(node, BLACK);
        return true;
      }
    }

    path.pop();
    color.set(node, BLACK);
    return false;
  }

  for (const node of allNodes) {
    if (color.get(node) === WHITE) {
      dfs(node);
    }
  }

  return cycles;
}
