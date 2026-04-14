import type { Edge } from "../models/graph.js";
import {
  hasCycle,
  findCyclePaths,
  findMissingTargets,
  findOrphanNodes,
} from "../utils/topology.js";

export interface ValidationResult {
  rule: string;
  passed: boolean;
  level: "error" | "warning";
  message: string;
}

export function validateGraph(
  nodeNames: string[],
  edges: Edge[]
): ValidationResult[] {
  if (nodeNames.length === 0) {
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
  const nameSet = new Set(nodeNames);
  results.push(...checkMissingDeps(edges, nameSet));
  results.push(...checkInvalidStatus(edges));
  results.push(...checkCycles(edges));
  results.push(...checkOrphans(edges, nameSet));
  return results;
}

export function checkMissingDeps(
  edges: Edge[],
  nodeNames: Set<string>
): ValidationResult[] {
  const results: ValidationResult[] = [];
  const missing = findMissingTargets(edges, nodeNames);

  for (const { edge, side } of missing) {
    const missingName = side === "from" ? edge.from : edge.to;
    results.push({
      rule: "missing-dep",
      passed: false,
      level: "error",
      message: `边引用的节点 '${missingName}' 不存在（${side}: ${side === "from" ? edge.from : edge.to}）`,
    });
  }

  return results;
}

const VALID_EXPECT_STATUSES = ["success", "skipped"];

export function checkInvalidStatus(edges: Edge[]): ValidationResult[] {
  const results: ValidationResult[] = [];

  for (const edge of edges) {
    if (
      edge.expect !== undefined &&
      !VALID_EXPECT_STATUSES.includes(edge.expect)
    ) {
      results.push({
        rule: "invalid-status",
        passed: false,
        level: "error",
        message: `边 '${edge.from}' -> '${edge.to}' 的期望状态 '${edge.expect}' 无效，仅支持: ${VALID_EXPECT_STATUSES.join(", ")}`,
      });
    }
  }

  return results;
}

export function checkCycles(edges: Edge[]): ValidationResult[] {
  if (!hasCycle(edges)) {
    return [];
  }

  const results: ValidationResult[] = [];
  const cyclePaths = findCyclePaths(edges);

  for (const cycle of cyclePaths) {
    results.push({
      rule: "cycle",
      passed: false,
      level: "error",
      message: `检测到循环依赖：${cycle.join(" -> ")}`,
    });
  }

  return results;
}

export function checkOrphans(
  edges: Edge[],
  nodeNames: Set<string>
): ValidationResult[] {
  const orphans = findOrphanNodes(edges, nodeNames);
  return orphans.map((name) => ({
    rule: "orphan",
    passed: false,
    level: "warning" as const,
    message: `节点 '${name}' 为孤立节点（无依赖关系）`,
  }));
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
