import type { Node } from "../models/node.js";
import { normalizeDependency } from "../models/node.js";
import { NODES_DIR, RUNS_DIR } from "../constants.js";
import { ensureDir, readJSON, writeJSON, fileExists, deleteFile, listFiles } from "../utils/file.js";
import { readdir } from "fs/promises";
import * as path from "path";
import { validateNodeFormat } from "../utils/json.js";
import { NodeNotFoundError, ValidationError, FileExistsError, CycleError } from "../errors.js";
import { hasCycle } from "../utils/cycle.js";

export async function createTemplate(name: string): Promise<string> {
  const filePath = `${NODES_DIR}/${name}.json`;
  if (await fileExists(filePath)) {
    throw new FileExistsError(filePath);
  }
  await ensureDir(NODES_DIR);

  const template: Node = {
    name,
    description: "",
    instructions: "",
    states: ["success", "failed"],
    default_state: "pending",
    depends_on: [],
  };

  await writeJSON(filePath, template);
  return filePath;
}

export async function addNode(filePath: string): Promise<Node> {
  const data = await readJSON<unknown>(filePath);
  const { valid, errors } = validateNodeFormat(data);
  if (!valid) {
    throw new ValidationError("节点文件格式不合法", errors);
  }

  const node = data as Node;
  const targetPath = `${NODES_DIR}/${node.name}.json`;
  if (await fileExists(targetPath)) {
    throw new FileExistsError(node.name);
  }

  await ensureDir(NODES_DIR);

  // 环检测：将新节点加入现有节点列表，检查是否产生环
  const existingNodes = await listNodes();
  existingNodes.push(node);
  if (hasCycle(existingNodes)) {
    throw new CycleError(node.name);
  }

  await writeJSON(targetPath, node);
  return node;
}

export async function removeNode(name: string): Promise<void> {
  const filePath = `${NODES_DIR}/${name}.json`;
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
  const filePath = `${NODES_DIR}/${name}.json`;
  return readJSON<Node>(filePath);
}

export async function listNodes(): Promise<Node[]> {
  const files = await listFiles(NODES_DIR);
  const nodes: Node[] = [];
  for (const file of files) {
    try {
      const node = await readJSON<Node>(`${NODES_DIR}/${file}`);
      nodes.push(node);
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
  return fileExists(`${NODES_DIR}/${name}.json`);
}
