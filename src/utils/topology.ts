import type { Edge } from "../models/graph.js";

/**
 * Build forward adjacency map: from -> [to, ...]
 * Represents dependency direction: from depends on to
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
 * Build reverse adjacency map: to -> [from, ...]
 * Represents influence direction: who depends on to
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
 * Detect whether the edge list contains a cycle (DFS three-color marking).
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
 * Check whether all dependencies of a node are satisfied.
 * Edge semantics: from depends on to, so nodeName's deps are edges[from === nodeName].
 * expect defaults to "success"; skipped is treated as equivalent to success.
 */
export function areDepsSatisfied(
  nodeName: string,
  edges: Edge[],
  states: Record<string, string>
): boolean {
  const deps = edges.filter((e) => e.from === nodeName);
  if (deps.length === 0) return true;

  return deps.every((edge) => {
    const expect = edge.expect ?? "success";
    const depState = states[edge.to];
    if (depState === expect) return true;
    // skipped is equivalent to success
    if (expect === "success" && depState === "skipped") return true;
    return false;
  });
}

/**
 * Collect direct upstream node names (nodes being depended on).
 * from depends on to, so nodeName's upstreams are the to values of edges[from === nodeName].
 */
export function collectUpstream(nodeName: string, edges: Edge[]): string[] {
  return edges.filter((e) => e.from === nodeName).map((e) => e.to);
}

/**
 * Collect direct downstream node names (nodes that depend on this node).
 * to is depended on, so nodeName's downstreams are the from values of edges[to === nodeName].
 */
export function collectDownstream(nodeName: string, edges: Edge[]): string[] {
  return edges.filter((e) => e.to === nodeName).map((e) => e.from);
}

/**
 * Find edges that reference non-existent node targets.
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
 * Find orphan nodes (not connected to any edge).
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
 * Find cycle paths (used for error messages).
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

/**
 * BFS topological layering: assign nodes to layers by dependency.
 * Layer 0: nodes with no dependencies (no incoming edges)
 * Layer N: nodes whose dependencies are all in Layer 0..N-1
 */
export function computeTopologicalLayers(
  edges: Edge[],
  nodeNames: string[]
): Map<number, string[]> {
  if (nodeNames.length === 0) return new Map();

  // Compute in-degree (dependency count) for each node
  const inDegree = new Map<string, number>();
  for (const name of nodeNames) {
    inDegree.set(name, 0);
  }
  for (const edge of edges) {
    // edge.from depends on edge.to, so from has an in-degree
    if (inDegree.has(edge.from)) {
      inDegree.set(edge.from, inDegree.get(edge.from)! + 1);
    }
  }

  // Reverse adjacency map: to -> [from, ...] (who depends on to)
  const reverseAdj = new Map<string, string[]>();
  for (const edge of edges) {
    const dependents = reverseAdj.get(edge.to) ?? [];
    dependents.push(edge.from);
    reverseAdj.set(edge.to, dependents);
  }

  const layers = new Map<number, string[]>();
  let currentLayer = [...inDegree.entries()]
    .filter(([, deg]) => deg === 0)
    .map(([name]) => name);

  let layerIndex = 0;
  const assigned = new Set<string>();

  while (currentLayer.length > 0) {
    layers.set(layerIndex, currentLayer);
    for (const name of currentLayer) {
      assigned.add(name);
    }

    const nextLayer: string[] = [];
    for (const name of currentLayer) {
      const dependents = reverseAdj.get(name) ?? [];
      for (const dep of dependents) {
        if (assigned.has(dep)) continue;
        const deg = inDegree.get(dep)! - 1;
        inDegree.set(dep, deg);
        if (deg === 0 && !assigned.has(dep)) {
          nextLayer.push(dep);
        }
      }
    }

    currentLayer = nextLayer;
    layerIndex++;
  }

  return layers;
}
