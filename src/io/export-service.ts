import type { Graph } from "../models/graph.js";
import * as yaml from "js-yaml";
import * as nodeService from "../graph/node-service.js";
import * as graphService from "../graph/graph-service.js";

/**
 * Export the specified graph and all referenced nodes as a multi-document YAML string.
 */
export async function exportToYAML(graphName: string): Promise<string>;
/**
 * Export all nodes and graphs as a multi-document YAML string.
 */
export async function exportToYAML(): Promise<string>;
export async function exportToYAML(graphName?: string): Promise<string> {
  const docs: unknown[] = [];

  if (graphName) {
    // Export specified graph + referenced nodes
    const graph = await graphService.loadGraph(graphName);
    const nodeNames = new Set<string>();
    for (const edge of graph.edges) {
      nodeNames.add(edge.from);
      nodeNames.add(edge.to);
    }

    docs.push({ kind: "Graph", ...graph });
    for (const name of nodeNames) {
      try {
        const node = await nodeService.getNode(name);
        docs.push({ kind: "Node", ...node });
      } catch {
        // Skip if node does not exist
      }
    }
  } else {
    // Export all graphs + all nodes
    const graphs = await graphService.listGraphs();
    for (const graph of graphs) {
      docs.push({ kind: "Graph", ...graph });
    }

    const nodes = await nodeService.listNodes();
    for (const node of nodes) {
      docs.push({ kind: "Node", ...node });
    }
  }

  return docs
    .map((doc) => yaml.dump(doc, { lineWidth: -1 }))
    .join("---\n");
}
