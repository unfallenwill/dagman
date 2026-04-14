import type { Graph } from "../models/graph.js";
import * as yaml from "js-yaml";
import * as nodeService from "./node-service.js";
import * as graphService from "./graph-service.js";

/**
 * 导出指定图及其引用的所有节点为 multi-document YAML 字符串。
 */
export async function exportToYAML(graphName: string): Promise<string>;
/**
 * 导出所有节点和所有图为 multi-document YAML 字符串。
 */
export async function exportToYAML(): Promise<string>;
export async function exportToYAML(graphName?: string): Promise<string> {
  const docs: unknown[] = [];

  if (graphName) {
    // 导出指定图 + 引用的节点
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
        // 节点不存在时跳过
      }
    }
  } else {
    // 导出所有图 + 所有节点
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
