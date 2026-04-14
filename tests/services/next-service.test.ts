import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import * as nextService from "../../src/services/next-service.js";
import * as nodeService from "../../src/services/node-service.js";
import * as graphService from "../../src/services/graph-service.js";
import * as stateService from "../../src/services/state-service.js";
import * as runService from "../../src/services/run-service.js";
import type { Edge } from "../../src/models/graph.js";

const TMP_DIR = path.join(os.tmpdir(), `dagman-next-test-${Date.now()}`);

let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  await fs.mkdir(TMP_DIR, { recursive: true });
  process.chdir(TMP_DIR);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await fs.rm(TMP_DIR, { recursive: true, force: true });
});

async function writeNode(name: string): Promise<void> {
  const node = {
    kind: "Node",
    name,
    description: `${name} desc`,
    instructions: `${name} instructions`,
  };
  await fs.mkdir(path.join(TMP_DIR, ".dagman/nodes"), { recursive: true });
  const yaml = await import("js-yaml");
  await fs.writeFile(
    path.join(TMP_DIR, `.dagman/nodes/${name}.yaml`),
    yaml.dump(node, { lineWidth: -1 })
  );
}

async function writeGraph(name: string, edges: Edge[]): Promise<void> {
  const graph = { kind: "Graph", name, edges };
  await fs.mkdir(path.join(TMP_DIR, ".dagman/graphs"), { recursive: true });
  const yaml = await import("js-yaml");
  await fs.writeFile(
    path.join(TMP_DIR, `.dagman/graphs/${name}.yaml`),
    yaml.dump(graph, { lineWidth: -1 })
  );
}

async function setupRunWithGraph(graphName: string, edges: Edge[]): Promise<string> {
  await writeGraph(graphName, edges);
  const run = await runService.createRun(undefined, graphName, true);
  return run.id;
}

describe("findNextNode", () => {
  it("should return first node with no dependencies", async () => {
    await writeNode("alpha");
    await writeNode("beta");
    await setupRunWithGraph("test", []);

    const result = await nextService.findNextNode();
    expect(result).not.toBeNull();
    expect(result!.node.name).toBe("alpha");
  });

  it("should skip nodes with state already set", async () => {
    await writeNode("alpha");
    await writeNode("beta");
    const runId = await setupRunWithGraph("test", []);

    await stateService.setState("alpha", "success", runId);

    const result = await nextService.findNextNode();
    expect(result!.node.name).toBe("beta");
  });

  it("should skip node whose dependency is not satisfied", async () => {
    await writeNode("alpha");
    await writeNode("beta");
    const runId = await setupRunWithGraph("test", [
      { from: "beta", to: "alpha" },
    ]);

    // alpha has no state yet, so beta's dep (alpha:success) is not satisfied
    // but alpha itself IS actionable
    const result = await nextService.findNextNode();
    expect(result!.node.name).toBe("alpha");
  });

  it("should return dependent node after dependency completed", async () => {
    await writeNode("alpha");
    await writeNode("beta");
    const runId = await setupRunWithGraph("test", [
      { from: "beta", to: "alpha" },
    ]);

    await stateService.setState("alpha", "success", runId);

    const result = await nextService.findNextNode();
    expect(result!.node.name).toBe("beta");
  });

  it("should return null when all nodes have state", async () => {
    await writeNode("alpha");
    const runId = await setupRunWithGraph("test", []);
    await stateService.setState("alpha", "success", runId);

    const result = await nextService.findNextNode();
    expect(result).toBeNull();
  });

  it("should return null when no nodes exist", async () => {
    await setupRunWithGraph("test", []);

    const result = await nextService.findNextNode();
    expect(result).toBeNull();
  });

  it("should handle diamond dependency graph", async () => {
    await writeNode("analyze");
    await writeNode("design");
    await writeNode("code");
    await writeNode("test");
    const runId = await setupRunWithGraph("test", [
      { from: "design", to: "analyze" },
      { from: "code", to: "design" },
      { from: "test", to: "code" },
    ]);

    // Step 1: analyze is actionable
    let result = await nextService.findNextNode();
    expect(result!.node.name).toBe("analyze");

    await stateService.setState("analyze", "success", runId);

    // Step 2: design is actionable
    result = await nextService.findNextNode();
    expect(result!.node.name).toBe("design");

    await stateService.setState("design", "success", runId);

    // Step 3: code is actionable
    result = await nextService.findNextNode();
    expect(result!.node.name).toBe("code");

    await stateService.setState("code", "success", runId);

    // Step 4: test is actionable
    result = await nextService.findNextNode();
    expect(result!.node.name).toBe("test");

    await stateService.setState("test", "success", runId);

    // All done
    result = await nextService.findNextNode();
    expect(result).toBeNull();
  });

  it("should handle parallel dependencies", async () => {
    await writeNode("design");
    await writeNode("write-code");
    await writeNode("write-tests");
    await writeNode("run-tests");
    const runId = await setupRunWithGraph("test", [
      { from: "write-code", to: "design" },
      { from: "write-tests", to: "design" },
      { from: "run-tests", to: "write-code" },
      { from: "run-tests", to: "write-tests" },
    ]);

    await stateService.setState("design", "success", runId);

    // write-code and write-tests both actionable; sorted alphabetically
    let result = await nextService.findNextNode();
    expect(result!.node.name).toBe("write-code");

    await stateService.setState("write-code", "success", runId);

    // write-tests still actionable
    result = await nextService.findNextNode();
    expect(result!.node.name).toBe("write-tests");

    // run-tests not yet — write-tests not done
    await stateService.setState("write-tests", "success", runId);

    result = await nextService.findNextNode();
    expect(result!.node.name).toBe("run-tests");
  });

  it("should include upstream context in result", async () => {
    await writeNode("alpha");
    await writeNode("beta");
    const runId = await setupRunWithGraph("test", [
      { from: "beta", to: "alpha" },
    ]);

    await stateService.setState("alpha", "success", runId);
    const { setContextField } = await import("../../src/services/context-service.js");
    await setContextField("alpha", "output", "analysis-result", runId);

    const result = await nextService.findNextNode();
    expect(result!.upstreamContext["alpha"]).toEqual({
      output: "analysis-result",
    });
  });

  it("should respect specific run ID", async () => {
    await writeNode("alpha");

    // Default run with graph
    const runId1 = await setupRunWithGraph("default-graph", []);
    await stateService.setState("alpha", "success", runId1);

    // Create another run with its own graph
    await writeGraph("other-graph", []);
    const runId2 = (await runService.createRun("other", "other-graph")).id;

    const result = await nextService.findNextNode(runId2);
    expect(result!.node.name).toBe("alpha");
  });

  it("should treat skipped as satisfying success dependency", async () => {
    await writeNode("alpha");
    await writeNode("beta");
    const runId = await setupRunWithGraph("test", [
      { from: "beta", to: "alpha" },
    ]);

    // Skip alpha instead of success
    await stateService.setState("alpha", "skipped", runId);

    const result = await nextService.findNextNode();
    expect(result!.node.name).toBe("beta");
  });

  it("should not activate downstream when dependency failed", async () => {
    await writeNode("alpha");
    await writeNode("beta");
    const runId = await setupRunWithGraph("test", [
      { from: "beta", to: "alpha" },
    ]);

    await stateService.setState("alpha", "failed", runId);

    const result = await nextService.findNextNode();
    expect(result).toBeNull();
  });
});
