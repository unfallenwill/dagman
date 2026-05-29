import type { Node } from "../models/node.js";
import { NODES_DIR } from "../constants.js";
import { ensureDir, readYAML, writeYAML, fileExists, deleteFile, listFiles } from "../utils/file.js";
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
}

export async function getNode(name: string): Promise<Node> {
  const filePath = `${NODES_DIR}/${name}.yaml`;
  const data = await readYAML<Record<string, unknown>>(filePath);
  const { kind: yamlKind, ...rest } = data;
  // yamlKind is "Node" for hand-created nodes (YAML discriminator),
  // or "user"/"collect"/"cond"/"fanout" for compiled nodes (real kind field)
  if (yamlKind && yamlKind !== "Node") {
    return { ...rest, kind: yamlKind as Node["kind"] } as unknown as Node;
  }
  return rest as unknown as Node;
}

export async function listNodes(): Promise<Node[]> {
  const files = await listFiles(NODES_DIR, ".yaml");
  const nodes: Node[] = [];
  for (const file of files) {
    try {
      const data = await readYAML<Record<string, unknown>>(`${NODES_DIR}/${file}`);
      const { kind: yamlKind, ...rest } = data;
      if (yamlKind && yamlKind !== "Node") {
        nodes.push({ ...rest, kind: yamlKind as Node["kind"] } as unknown as Node);
      } else {
        nodes.push(rest as unknown as Node);
      }
    } catch {
      // Skip if a single file fails to parse
    }
  }
  return nodes;
}

export async function nodeExists(name: string): Promise<boolean> {
  return fileExists(`${NODES_DIR}/${name}.yaml`);
}
