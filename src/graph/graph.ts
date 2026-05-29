import type { Node } from "../models/node.js";
import type { Edge, Graph } from "../models/graph.js";
import type { Task } from "../models/task.js";
import { GRAPHS_DIR } from "../constants.js";
import { ensureDir, readYAML, writeYAML, writeJSON, fileExists, deleteFile, listFiles } from "../utils/file.js";
import { GraphNotFoundError } from "../errors.js";
import * as nodeService from "./node.js";

// ── Graph CRUD ──

export async function loadGraph(name: string): Promise<Graph> {
  // Try YAML first (user-created), then JSON (compiled from TS workflow)
  const yamlPath = GRAPHS_DIR + "/" + name + ".yaml";
  if (await fileExists(yamlPath)) {
    const data = await readYAML<Record<string, unknown>>(yamlPath);
    const { kind, ...graphData } = data;
    return graphData as unknown as Graph;
  }
  // Fallback to compiled JSON graph
  return loadCompiledGraph(name);
}

export async function saveGraph(graph: Graph): Promise<void> {
  const filePath = GRAPHS_DIR + "/" + graph.name + ".yaml";
  await ensureDir(GRAPHS_DIR);
  await writeYAML(filePath, { kind: "Graph", ...graph });
}

export async function listGraphs(): Promise<Graph[]> {
  const graphs: Graph[] = [];

  // Load YAML graphs
  const yamlFiles = await listFiles(GRAPHS_DIR, ".yaml");
  for (const file of yamlFiles) {
    try {
      const data = await readYAML<Record<string, unknown>>(GRAPHS_DIR + "/" + file);
      const { kind, ...graphData } = data;
      graphs.push(graphData as unknown as Graph);
    } catch {
      // Skip if a single file fails to parse
    }
  }

  // Load compiled JSON graphs
  const jsonFiles = await listFiles(GRAPHS_DIR, ".json");
  for (const file of jsonFiles) {
    try {
      const fs = await import("fs/promises");
      const content = await fs.readFile(GRAPHS_DIR + "/" + file, "utf-8");
      graphs.push(JSON.parse(content) as Graph);
    } catch {
      // Skip if a single file fails to parse
    }
  }

  return graphs;
}

export async function graphExists(name: string): Promise<boolean> {
  const yamlOk = await fileExists(GRAPHS_DIR + "/" + name + ".yaml");
  if (yamlOk) return true;
  const jsonOk = await fileExists(GRAPHS_DIR + "/" + name + ".json");
  return jsonOk;
}

/** Load a compiled JSON graph (from tsx workflow compilation) */
export async function loadCompiledGraph(name: string): Promise<Graph> {
  const filePath = GRAPHS_DIR + "/" + name + ".json";
  if (!(await fileExists(filePath))) {
    throw new GraphNotFoundError(name);
  }
  const fs = await import("fs/promises");
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content) as Graph;
}

/** Save a compiled graph as JSON (from tsx workflow compilation) */
export async function saveCompiledGraph(graph: Graph): Promise<void> {
  await ensureDir(GRAPHS_DIR);
  const filePath = GRAPHS_DIR + "/" + graph.name + ".json";
  await writeJSON(filePath, graph);
}

export async function removeGraph(name: string): Promise<void> {
  const filePath = GRAPHS_DIR + "/" + name + ".yaml";
  if (!(await fileExists(filePath))) {
    throw new GraphNotFoundError(name);
  }
  await deleteFile(filePath);
}

// ── Graph Display ──

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return hh + ":" + mm;
}

export function formatGraph(
  nodes: Node[],
  edges: Edge[],
  tasks: Task[],
  timestamps?: Record<string, string>
): string {
  if (nodes.length === 0) {
    return "no registered nodes";
  }

  const ts = timestamps ?? {};
  const taskMap = new Map(tasks.map((t) => [t.nodeId, t]));
  const sorted = [...nodes].sort((a, b) => a.name.localeCompare(b.name));

  return sorted
    .map((node) => {
      const task = taskMap.get(node.name);
      const status = task?.status ?? "pending";
      const statusDisplay = ts[node.name]
        ? status + " " + formatTimestamp(ts[node.name])
        : status;
      const inEdges = edges
        .filter((e) => e.from === node.name)
        .map((e) => {
          const expect = e.expect ?? "success";
          return e.to + ":" + expect;
        })
        .join(", ");

      if (inEdges) {
        return node.name + " [" + statusDisplay + "] -> " + inEdges;
      }
      return node.name + " [" + statusDisplay + "]";
    })
    .join("\n");
}
