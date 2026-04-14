import type { Node } from "../models/node.js";
import { NODES_DIR, RUNS_DIR } from "../constants.js";
import { ensureDir, readYAML, writeYAML, fileExists, deleteFile, listFiles } from "../utils/file.js";
import { readdir } from "fs/promises";
import * as path from "path";
import { NodeNotFoundError, FileExistsError } from "../errors.js";

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
  };

  await writeYAML(filePath, template);
  return filePath;
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

export async function nodeExists(name: string): Promise<boolean> {
  return fileExists(`${NODES_DIR}/${name}.yaml`);
}
