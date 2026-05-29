import type { Node } from "../models/node.js";
import type { Graph } from "../models/graph.js";
import { NODES_DIR, GRAPHS_DIR } from "../constants.js";
import { writeYAML, ensureDir } from "../utils/file.js";
import { validateNodeFormat, validateGraphFormat } from "../utils/json.js";
import * as nodeService from "../graph/node.js";
import * as graphService from "../graph/graph.js";
import { hasCycle, collectUpstream } from "../utils/topology.js";
import { extractVarRefs } from "../utils/template.js";
import { ValidationError } from "../errors.js";

export interface ImportResult {
  importedNodes: string[];
  skippedNodes: string[];
  importedGraphs: string[];
  skippedGraphs: string[];
}

export async function importFromYAML(content: string): Promise<ImportResult> {
  const docs = await parseYAMLDocs(content);

  const nodeDocs = docs.filter(
    (d) => d.kind === "Node" || (!("kind" in d) && "name" in d && !("edges" in d))
  );
  const graphDocs = docs.filter((d) => d.kind === "Graph");

  if (nodeDocs.length === 0 && graphDocs.length === 0) {
    throw new ValidationError("YAML file contains no node or graph definitions", []);
  }

  // Validate and extract nodes
  const nodes: Node[] = [];
  for (const doc of nodeDocs) {
    const nodeData = { ...doc };
    delete nodeData.kind;
    const { valid, errors } = validateNodeFormat(nodeData);
    if (!valid) {
      throw new ValidationError(`node '${doc.name ?? "?"}' has invalid format`, errors);
    }
    nodes.push(nodeData as unknown as Node);
  }

  // Validate and extract graphs
  const graphs: Graph[] = [];
  for (const doc of graphDocs) {
    const graphData = { ...doc };
    delete graphData.kind;
    const { valid, errors } = validateGraphFormat(graphData);
    if (!valid) {
      throw new ValidationError(`graph '${doc.name ?? "?"}' has invalid format`, errors);
    }
    graphs.push(graphData as unknown as Graph);
  }

  // Check for duplicate nodes (within file)
  const nodeNames = new Set<string>();
  for (const node of nodes) {
    if (nodeNames.has(node.name)) {
      throw new ValidationError(`duplicate node name in YAML file: '${node.name}'`, []);
    }
    nodeNames.add(node.name);
  }

  // Check for duplicate graphs (within file)
  const graphNames = new Set<string>();
  for (const graph of graphs) {
    if (graphNames.has(graph.name)) {
      throw new ValidationError(`duplicate graph name in YAML file: '${graph.name}'`, []);
    }
    graphNames.add(graph.name);
  }

  // Check for conflicts with existing nodes
  const existingNodes = await nodeService.listNodes();
  const importedNodes: string[] = [];
  const skippedNodes: string[] = [];

  for (const node of nodes) {
    if (existingNodes.some((n) => n.name === node.name)) {
      skippedNodes.push(node.name);
      continue;
    }
    existingNodes.push(node);
    importedNodes.push(node.name);
  }

  // Check for conflicts with existing graphs
  const existingGraphs = await graphService.listGraphs();
  const importedGraphs: string[] = [];
  const skippedGraphs: string[] = [];

  const newGraphs: Graph[] = [];
  for (const graph of graphs) {
    if (existingGraphs.some((g) => g.name === graph.name)) {
      skippedGraphs.push(graph.name);
      continue;
    }
    newGraphs.push(graph);
    importedGraphs.push(graph.name);
  }

  // Cycle detection per graph
  for (const graph of newGraphs) {
    if (graph.edges.length > 0 && hasCycle(graph.edges)) {
      throw new ValidationError(`graph '${graph.name}' contains cycle dependency, check edge configuration`, []);
    }
  }

  // Validate variable references: check if node-name in {{node-name.key}} is an upstream node
  const allNodeNames = new Set(nodes.map((n) => n.name).concat(existingNodes.map((n) => n.name)));
  for (const graph of newGraphs) {
    for (const node of nodes) {
      const refs = extractVarRefs(node.instructions);
      const upstream = new Set(collectUpstream(node.name, graph.edges));
      for (const ref of refs) {
        if (ref.source === "node") {
          if (!allNodeNames.has(ref.nodeName!)) {
            throw new ValidationError(
              `node '${node.name}' instructions reference non-existent node '${ref.nodeName}'`,
              [`variable {{${ref.expr}}} references a node that does not exist`]
            );
          }
          if (!upstream.has(ref.nodeName!)) {
            throw new ValidationError(
              `node '${node.name}' instructions reference non-upstream node '${ref.nodeName}'`,
              [`variable {{${ref.expr}}} references a node that is not an upstream dependency of '${node.name}'`]
            );
          }
        }
      }
    }
  }

  // Persist nodes
  if (importedNodes.length > 0) {
    await ensureDir(NODES_DIR);
    for (const name of importedNodes) {
      const node = nodes.find((n) => n.name === name)!;
      await writeYAML(`${NODES_DIR}/${name}.yaml`, { kind: "Node", ...node });
    }
  }

  // Persist graphs
  if (importedGraphs.length > 0) {
    await ensureDir(GRAPHS_DIR);
    for (const graph of newGraphs) {
      await writeYAML(`${GRAPHS_DIR}/${graph.name}.yaml`, {
        kind: "Graph",
        ...graph,
      });
    }
  }

  return { importedNodes, skippedNodes, importedGraphs, skippedGraphs };
}

async function parseYAMLDocs(content: string): Promise<Record<string, unknown>[]> {
  const yaml = await import("js-yaml");
  const docs: Record<string, unknown>[] = [];
  yaml.loadAll(content, (doc: unknown) => {
    if (doc != null && typeof doc === "object") {
      docs.push(doc as Record<string, unknown>);
    }
  });
  return docs;
}
