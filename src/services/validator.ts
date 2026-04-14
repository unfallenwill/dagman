import type { Node } from "../models/node.js";
import { normalizeDependency } from "../models/node.js";
import { hasCycle } from "../utils/cycle.js";
import * as nodeService from "./node-service.js";

export interface ValidationResult {
  rule: string;
  passed: boolean;
  level: "error" | "warning";
  message: string;
}

export async function validateGraph(): Promise<ValidationResult[]> {
  const nodes = await nodeService.listNodes();

  if (nodes.length === 0) {
    return [
      {
        rule: "empty-graph",
        passed: true,
        level: "warning",
        message: "任务图为空，无需校验",
      },
    ];
  }

  const results: ValidationResult[] = [];
  results.push(...checkMissingDeps(nodes));
  results.push(...checkInvalidStatus(nodes));
  results.push(...checkCycles(nodes));
  results.push(...checkOrphans(nodes));
  return results;
}

export function checkMissingDeps(nodes: Node[]): ValidationResult[] {
  const results: ValidationResult[] = [];
  const names = new Set(nodes.map((n) => n.name));

  for (const node of nodes) {
    for (const dep of node.depends_on) {
      const norm = normalizeDependency(dep);
      if (!names.has(norm.node)) {
        results.push({
          rule: "missing-dep",
          passed: false,
          level: "error",
          message: `节点 '${node.name}' 依赖的节点 '${norm.node}' 不存在`,
        });
      }
    }
  }

  return results;
}

const VALID_DEPENDENCY_STATUSES = ["success", "skipped"];

export function checkInvalidStatus(nodes: Node[]): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (const node of nodes) {
    for (const dep of node.depends_on) {
      const norm = normalizeDependency(dep);
      if (!VALID_DEPENDENCY_STATUSES.includes(norm.status)) {
        results.push({
          rule: "invalid-status",
          passed: false,
          level: "error",
          message: `节点 '${node.name}' 依赖 '${norm.node}' 的状态 '${norm.status}' 无效，依赖状态仅支持: ${VALID_DEPENDENCY_STATUSES.join(", ")}`,
        });
      }
    }
  }

  return results;
}

export function checkCycles(nodes: Node[]): ValidationResult[] {
  if (!hasCycle(nodes)) {
    return [];
  }

  // 找到具体的循环路径用于错误信息
  const results: ValidationResult[] = [];
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    adj.set(
      node.name,
      node.depends_on.map((d) => normalizeDependency(d).node)
    );
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const node of nodes) {
    color.set(node.name, WHITE);
  }

  const dfsPath: string[] = [];

  function dfs(node: string): boolean {
    color.set(node, GRAY);
    dfsPath.push(node);

    const neighbors = adj.get(node) ?? [];
    for (const neighbor of neighbors) {
      if (!color.has(neighbor)) continue;
      const c = color.get(neighbor)!;
      if (c === GRAY) {
        const cycleStart = dfsPath.indexOf(neighbor);
        const cycle = dfsPath.slice(cycleStart).join(" -> ");
        results.push({
          rule: "cycle",
          passed: false,
          level: "error",
          message: `检测到循环依赖：${cycle}`,
        });
        dfsPath.pop();
        color.set(node, BLACK);
        return true;
      }
      if (c === WHITE && dfs(neighbor)) {
        dfsPath.pop();
        color.set(node, BLACK);
        return true;
      }
    }

    dfsPath.pop();
    color.set(node, BLACK);
    return false;
  }

  for (const node of nodes) {
    if (color.get(node.name) === WHITE) {
      dfs(node.name);
    }
  }

  return results;
}

export function checkOrphans(nodes: Node[]): ValidationResult[] {
  const results: ValidationResult[] = [];
  const connected = new Set<string>();

  for (const node of nodes) {
    if (node.depends_on.length > 0) {
      connected.add(node.name);
    }
    for (const dep of node.depends_on) {
      connected.add(normalizeDependency(dep).node);
    }
  }

  for (const node of nodes) {
    if (!connected.has(node.name)) {
      results.push({
        rule: "orphan",
        passed: false,
        level: "warning",
        message: `节点 '${node.name}' 为孤立节点（无依赖关系）`,
      });
    }
  }

  return results;
}

export function formatValidationResults(results: ValidationResult[]): string {
  const hasErrors = results.some((r) => r.level === "error" && !r.passed);
  const hasWarnings = results.some((r) => r.level === "warning" && !r.passed);

  if (!hasErrors && !hasWarnings) {
    // 检查是否是空图提示
    const emptyGraph = results.find((r) => r.rule === "empty-graph");
    if (emptyGraph) {
      return emptyGraph.message;
    }
    return "任务图校验通过，无问题";
  }

  const errors = results.filter((r) => r.level === "error" && !r.passed);
  const warnings = results.filter((r) => r.level === "warning" && !r.passed);

  const lines: string[] = [];
  for (const err of errors) {
    lines.push(`[ERROR] ${err.message}`);
  }
  for (const warn of warnings) {
    lines.push(`[WARNING] ${warn.message}`);
  }

  return lines.join("\n");
}
