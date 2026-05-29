import * as path from "path";
import type { Graph } from "../models/graph.js";
import type { Node } from "../models/node.js";
import type { WorkflowDefinition, WorkflowManifest } from "../models/workflow-def.js";
import { WORKFLOWS_DIR, getWorkflowTsFile, getWorkflowManifest } from "../constants.js";
import { ensureDir, writeYAML } from "../utils/file.js";
import { hasCycle } from "../utils/topology.js";
import { ValidationError } from "../errors.js";
import { saveCompiledGraph } from "../graph/graph.js";
import { expandWorkflow } from "./node-gen.js";

export interface CompileResult {
  graph: Graph;
  nodes: Node[];
  manifest: WorkflowManifest;
}

/**
 * Compile a TS workflow: tsx import → expand collect/condEdge nodes → persist.
 */
export async function compileWorkflow(workflowName: string): Promise<CompileResult> {
  const tsFile = getWorkflowTsFile(workflowName);
  const manifestFile = getWorkflowManifest(workflowName);

  // 1. Load manifest
  const manifest = await loadManifest(manifestFile);

  // 2. tsx dynamic import → execute TS file → get WorkflowDefinition
  const definition = await importAndBuild(tsFile);

  // 3. Validate definition name matches workflow name
  if (definition.name !== workflowName) {
    throw new ValidationError(
      "workflow name mismatch: file exports '" + definition.name + "' but expected '" + workflowName + "'",
    );
  }

  // 4. Expand: generate collect nodes, condEdge nodes, rewire edges
  const { allNodes, allEdges } = expandWorkflow(definition);

  // 5. Build compiled Graph
  const graph: Graph = {
    name: workflowName,
    edges: allEdges,
    stateSchema: definition.stateSchema,
    workflowName,
  };

  // 6. Cycle detection
  if (hasCycle(graph.edges)) {
    throw new ValidationError("compiled graph contains cycle dependency");
  }

  // 7. Persist: graph as JSON, nodes as YAML
  await persistCompiledGraph(graph, allNodes);

  return { graph, nodes: allNodes, manifest };
}

/**
 * tsx dynamic import the TS workflow file and call build().
 * Uses tsx register to handle .ts files at runtime.
 */
async function importAndBuild(tsFile: string): Promise<WorkflowDefinition> {
  const absPath = path.resolve(tsFile);

  // Register tsx for .ts support, then import
  // tsx/esm is a dev dependency; we use dynamic import to avoid
  // requiring it at build time
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { register } = require("tsx/esm") as { register: () => void };
    register();
  } catch {
    // tsx may already be registered or not needed
  }

  const mod = await import(absPath);

  if (!mod.default || typeof mod.default !== "object") {
    throw new ValidationError("workflow file must export a default WorkflowDefinition");
  }

  return mod.default as WorkflowDefinition;
}

/**
 * Load and validate manifest.yaml
 */
async function loadManifest(manifestFile: string): Promise<WorkflowManifest> {
  const fs = await import("fs/promises");
  const yaml = await import("js-yaml");

  let content: string;
  try {
    content = await fs.readFile(path.resolve(manifestFile), "utf-8");
  } catch {
    throw new ValidationError("manifest not found: " + manifestFile);
  }

  const data = yaml.load(content) as Record<string, unknown>;

  if (!data.name || typeof data.name !== "string") {
    throw new ValidationError("manifest must have a 'name' field");
  }

  return {
    name: data.name,
    version: (data.version as string) || "0.0.0",
    description: (data.description as string) || "",
    author: data.author as string | undefined,
    repository: data.repository as string | undefined,
    license: data.license as string | undefined,
  };
}

/**
 * Persist compiled graph and expanded nodes.
 */
async function persistCompiledGraph(graph: Graph, nodes: Node[]): Promise<void> {
  // Save graph as compiled JSON
  await saveCompiledGraph(graph);

  // Save each node as YAML (same format as existing nodes, with extra fields)
  const NODES_DIR = ".dagman/nodes";
  await ensureDir(NODES_DIR);

  for (const node of nodes) {
    const filePath = NODES_DIR + "/" + node.name + ".yaml";
    await writeYAML(filePath, { kind: "Node", ...node });
  }
}
