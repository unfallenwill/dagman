import type { Node } from "../models/node.js";
import { NODES_DIR } from "../constants.js";
import { readYAMLAll, writeYAML, ensureDir } from "../utils/file.js";
import { validateNodeFormat } from "../utils/json.js";
import * as nodeService from "./node-service.js";
import { hasCycle } from "../utils/cycle.js";
import { ValidationError, FileExistsError } from "../errors.js";

export async function initFromPlan(filePath: string): Promise<{ imported: string[]; skipped: string[] }> {
  const docs = await readYAMLAll<Record<string, unknown>>(filePath);
  const nodeDocs = docs.filter((d) => d.kind === "Node" || (!("kind" in d) && "name" in d));

  if (nodeDocs.length === 0) {
    throw new ValidationError("plan 文件不包含任何节点定义", []);
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

  // 检测文件内重复
  const names = new Set<string>();
  for (const node of nodes) {
    if (names.has(node.name)) {
      throw new ValidationError(`plan 文件中存在重复节点名: '${node.name}'`, []);
    }
    names.add(node.name);
  }

  // 检测与已有节点冲突
  const existingNodes = await nodeService.listNodes();
  const imported: string[] = [];
  const skipped: string[] = [];

  for (const node of nodes) {
    if (existingNodes.some((n) => n.name === node.name)) {
      skipped.push(node.name);
      continue;
    }
    existingNodes.push(node);
    imported.push(node.name);
  }

  if (imported.length > 0) {
    // 全量环检测
    if (hasCycle(existingNodes)) {
      throw new ValidationError("导入后会产生循环依赖，请检查 depends_on 配置", []);
    }

    await ensureDir(NODES_DIR);
    for (const name of imported) {
      const node = nodes.find((n) => n.name === name)!;
      await writeYAML(`${NODES_DIR}/${name}.yaml`, { kind: "Node", ...node });
    }
  }

  return { imported, skipped };
}
