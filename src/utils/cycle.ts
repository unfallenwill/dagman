import type { Node } from "../models/node.js";
import { normalizeDependency } from "../models/node.js";

/**
 * 检测节点列表中是否存在循环依赖。
 * 返回 true 表示存在环，false 表示无环。
 */
export function hasCycle(nodes: Node[]): boolean {
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    adj.set(
      node.name,
      node.depends_on.map((d) => normalizeDependency(d).node)
    );
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const node of nodes) {
    color.set(node.name, WHITE);
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

  for (const node of nodes) {
    if (color.get(node.name) === WHITE) {
      if (dfs(node.name)) return true;
    }
  }

  return false;
}
