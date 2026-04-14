import type { Node } from "../models/node.js";
import { normalizeDependency } from "../models/node.js";
import { NODES_DIR, RUNS_DIR } from "../constants.js";
import { ensureDir, readYAML, readYAMLAll, writeYAML, fileExists, deleteFile, listFiles } from "../utils/file.js";
import { readdir } from "fs/promises";
import * as path from "path";
import { validateNodeFormat } from "../utils/json.js";
import { NodeNotFoundError, ValidationError, FileExistsError, CycleError } from "../errors.js";
import { hasCycle } from "../utils/cycle.js";

export async function createTemplate(name: string): Promise<string> {
  const filePath = `${NODES_DIR}/${name}.yaml`;
  if (await fileExists(filePath)) {
    throw new FileExistsError(filePath);
  }
  await ensureDir(NODES_DIR);

  const template = {
    kind: "Node",
    name,
    description: "",
    instructions: "",
    depends_on: [],
  };

  await writeYAML(filePath, template);
  return filePath;
}

export async function addNode(filePath: string): Promise<Node> {
  const docs = await readYAMLAll<Record<string, unknown>>(filePath);
  if (docs.length === 0) {
    throw new ValidationError("节点文件格式不合法", ["文件为空"]);
  }

  const results: Node[] = [];
  for (const data of docs) {
    const nodeData = { ...data };
    delete nodeData.kind;
    const { valid, errors } = validateNodeFormat(nodeData);
    if (!valid) {
      throw new ValidationError("节点文件格式不合法", errors);
    }
    results.push(nodeData as unknown as Node);
  }

  // 单文档模式：只注册第一个节点
  const node = results[0];
  const targetPath = `${NODES_DIR}/${node.name}.yaml`;
  if (await fileExists(targetPath)) {
    throw new FileExistsError(node.name);
  }

  await ensureDir(NODES_DIR);

  const existingNodes = await listNodes();
  existingNodes.push(node);
  if (hasCycle(existingNodes)) {
    throw new CycleError(node.name);
  }

  await writeYAML(targetPath, { kind: "Node", ...node });
  return node;
}

export async function addNodeDirect(node: Node): Promise<void> {
  const targetPath = `${NODES_DIR}/${node.name}.yaml`;
  if (await fileExists(targetPath)) {
    throw new FileExistsError(node.name);
  }
  await writeYAML(targetPath, { kind: "Node", ...node });
}

export async function removeNode(name: string): Promise<void> {
  const filePath = `${NODES_DIR}/${name}.yaml`;
  if (!(await fileExists(filePath))) {
    throw new NodeNotFoundError(name);
  }
  await deleteFile(filePath);
  // 清理所有运行实例中的上下文文件
  try {
    const entries = await readdir(path.resolve(RUNS_DIR));
    for (const entry of entries) {
      await deleteFile(`${RUNS_DIR}/${entry}/context/${name}.json`);
    }
  } catch {
    // runs 目录不存在时忽略
  }
}

export async function getNode(name: string): Promise<Node> {
  const filePath = `${NODES_DIR}/${name}.yaml`;
  const data = await readYAML<Record<string, unknown>>(filePath);
  const { kind, ...nodeData } = data;
  return nodeData as unknown as Node;
}

export async function listNodes(): Promise<Node[]> {
  const files = await listFiles(NODES_DIR, ".yaml");
  const nodes: Node[] = [];
  for (const file of files) {
    try {
      const data = await readYAML<Record<string, unknown>>(`${NODES_DIR}/${file}`);
      const { kind, ...nodeData } = data;
      nodes.push(nodeData as unknown as Node);
    } catch {
      // 单个文件解析失败时跳过
    }
  }
  return nodes;
}

export async function findDependents(nodeName: string): Promise<string[]> {
  const nodes = await listNodes();
  const dependents: string[] = [];
  for (const node of nodes) {
    for (const dep of node.depends_on) {
      const normalized = normalizeDependency(dep);
      if (normalized.node === nodeName) {
        dependents.push(node.name);
        break;
      }
    }
  }
  return dependents;
}

export async function nodeExists(name: string): Promise<boolean> {
  return fileExists(`${NODES_DIR}/${name}.yaml`);
}
