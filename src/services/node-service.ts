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
  // Clean up channels for this node across all runs
  try {
    const entries = await readdir(path.resolve(RUNS_DIR));
    for (const entry of entries) {
      try {
        const { clearChannels } = await import("./workflow-service.js");
        await clearChannels(name, entry);
      } catch {
        // Ignore if workflow is not initialized
      }
    }
  } catch {
    // Ignore if runs directory does not exist
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
      // Skip if a single file fails to parse
    }
  }
  return nodes;
}

export async function nodeExists(name: string): Promise<boolean> {
  return fileExists(`${NODES_DIR}/${name}.yaml`);
}
