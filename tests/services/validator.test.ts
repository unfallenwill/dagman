import { describe, it, expect } from "vitest";
import type { Node } from "../../src/models/node.js";
import {
  checkMissingDeps,
  checkInvalidStatus,
  checkCycles,
  checkOrphans,
  validateGraph,
  formatValidationResults,
} from "../../src/services/validator.js";

const makeNode = (
  name: string,
  depends_on: Node["depends_on"] = [],
): Node => ({
  name,
  description: `${name} desc`,
  instructions: `${name} instructions`,
  depends_on,
});

describe("checkMissingDeps", () => {
  it("should pass when all deps exist", () => {
    const nodes = [makeNode("a", ["b"]), makeNode("b")];
    const results = checkMissingDeps(nodes);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("should report error for missing dep", () => {
    const nodes = [makeNode("a", ["nonexistent"])];
    const results = checkMissingDeps(nodes);
    expect(results.some((r) => r.level === "error" && !r.passed)).toBe(true);
  });
});

describe("checkInvalidStatus", () => {
  it("should pass when status is in target states", () => {
    const nodes = [
      makeNode("a", [{ node: "b", status: "success" }]),
      makeNode("b"),
    ];
    const results = checkInvalidStatus(nodes);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("should report error when status not in target states", () => {
    const nodes = [
      makeNode("a", [{ node: "b", status: "invalid_status" }]),
      makeNode("b"),
    ];
    const results = checkInvalidStatus(nodes);
    expect(results.some((r) => r.level === "error" && !r.passed)).toBe(true);
  });

  it("should skip when target node does not exist", () => {
    const nodes = [makeNode("a", [{ node: "ghost", status: "success" }])];
    const results = checkInvalidStatus(nodes);
    expect(results.length).toBe(0);
  });
});

describe("checkCycles", () => {
  it("should pass with no cycles", () => {
    const nodes = [makeNode("a", ["b"]), makeNode("b")];
    const results = checkCycles(nodes);
    expect(results.length).toBe(0);
  });

  it("should detect A -> B -> A cycle", () => {
    const nodes = [makeNode("a", ["b"]), makeNode("b", ["a"])];
    const results = checkCycles(nodes);
    expect(results.some((r) => r.level === "error")).toBe(true);
    expect(results[0].message).toContain("循环依赖");
  });

  it("should detect A -> B -> C -> A cycle", () => {
    const nodes = [
      makeNode("a", ["b"]),
      makeNode("b", ["c"]),
      makeNode("c", ["a"]),
    ];
    const results = checkCycles(nodes);
    expect(results.some((r) => r.level === "error")).toBe(true);
  });
});

describe("checkOrphans", () => {
  it("should pass with no orphans", () => {
    const nodes = [makeNode("a", ["b"]), makeNode("b")];
    const results = checkOrphans(nodes);
    expect(results.length).toBe(0);
  });

  it("should report warning for orphan nodes", () => {
    const nodes = [makeNode("lonely")];
    const results = checkOrphans(nodes);
    expect(results.length).toBe(1);
    expect(results[0].level).toBe("warning");
    expect(results[0].message).toContain("孤立节点");
  });
});

describe("formatValidationResults", () => {
  it("should return pass message when no issues", () => {
    const result = formatValidationResults([]);
    expect(result).toBe("任务图校验通过，无问题");
  });

  it("should format errors before warnings", () => {
    const results = [
      {
        rule: "orphan",
        passed: false,
        level: "warning" as const,
        message: "孤立节点",
      },
      {
        rule: "missing",
        passed: false,
        level: "error" as const,
        message: "依赖不存在",
      },
    ];
    const formatted = formatValidationResults(results);
    const lines = formatted.split("\n");
    expect(lines[0]).toContain("[ERROR]");
    expect(lines[1]).toContain("[WARNING]");
  });
});
