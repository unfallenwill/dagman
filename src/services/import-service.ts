import type { Node } from "../models/node.js";
import type { Graph } from "../models/graph.js";
import { NODES_DIR, GRAPHS_DIR } from "../constants.js";
import { writeYAML, ensureDir } from "../utils/file.js";
import { validateNodeFormat, validateGraphFormat } from "../utils/json.js";
import * as nodeService from "./node-service.js";
import * as graphService from "./graph-service.js";
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
    throw new ValidationError("YAML 文件不包含任何节点或图定义", []);
  }

  // 校验并提取节点
  const nodes: Node[] = [];
  for (const doc of nodeDocs) {
    const nodeData = { ...doc };
    delete nodeData.kind;
    const { valid, errors } = validateNodeFormat(nodeData);
    if (!valid) {
      throw new ValidationError(`节点 '${doc.name ?? "?"}' 格式不合法`, errors);
    }
    nodes.push(nodeData as unknown as Node);
  }

  // 校验并提取图
  const graphs: Graph[] = [];
  for (const doc of graphDocs) {
    const graphData = { ...doc };
    delete graphData.kind;
    const { valid, errors } = validateGraphFormat(graphData);
    if (!valid) {
      throw new ValidationError(`图 '${doc.name ?? "?"}' 格式不合法`, errors);
    }
    graphs.push(graphData as unknown as Graph);
  }

  // 检测节点重复（文件内）
  const nodeNames = new Set<string>();
  for (const node of nodes) {
    if (nodeNames.has(node.name)) {
      throw new ValidationError(`YAML 文件中存在重复节点名: '${node.name}'`, []);
    }
    nodeNames.add(node.name);
  }

  // 检测图重复（文件内）
  const graphNames = new Set<string>();
  for (const graph of graphs) {
    if (graphNames.has(graph.name)) {
      throw new ValidationError(`YAML 文件中存在重复图名: '${graph.name}'`, []);
    }
    graphNames.add(graph.name);
  }

  // 检测与已有节点冲突
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

  // 检测与已有图冲突
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

  // 逐图环检测
  for (const graph of newGraphs) {
    if (graph.edges.length > 0 && hasCycle(graph.edges)) {
      throw new ValidationError(`图 '${graph.name}' 包含循环依赖，请检查边的配置`, []);
    }
  }

  // 验证变量引用：检查 {{node-name.key}} 中的 node-name 是否为上游节点
  const allNodeNames = new Set(nodes.map((n) => n.name).concat(existingNodes.map((n) => n.name)));
  for (const graph of newGraphs) {
    for (const node of nodes) {
      const refs = extractVarRefs(node.instructions);
      const upstream = new Set(collectUpstream(node.name, graph.edges));
      for (const ref of refs) {
        if (ref.source === "node") {
          if (!allNodeNames.has(ref.nodeName!)) {
            throw new ValidationError(
              `节点 '${node.name}' 的指令引用了不存在的节点 '${ref.nodeName}'`,
              [`变量 {{${ref.expr}}} 引用的节点不存在`]
            );
          }
          if (!upstream.has(ref.nodeName!)) {
            throw new ValidationError(
              `节点 '${node.name}' 的指令引用了非上游节点 '${ref.nodeName}'`,
              [`变量 {{${ref.expr}}} 引用的节点不是 '${node.name}' 的上游依赖`]
            );
          }
        }
      }
    }
  }

  // 持久化节点
  if (importedNodes.length > 0) {
    await ensureDir(NODES_DIR);
    for (const name of importedNodes) {
      const node = nodes.find((n) => n.name === name)!;
      await writeYAML(`${NODES_DIR}/${name}.yaml`, { kind: "Node", ...node });
    }
  }

  // 持久化图
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
