import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import * as contextService from "../../src/services/context-service.js";
import * as nodeService from "../../src/services/node-service.js";
import * as graphService from "../../src/services/graph-service.js";
import * as stateService from "../../src/services/state-service.js";
import * as runService from "../../src/services/run-service.js";
import * as nextService from "../../src/services/next-service.js";
import * as importService from "../../src/services/import-service.js";
import { ValidationError } from "../../src/errors.js";

const TMP_DIR = path.join(os.tmpdir(), `dagman-ctx-test-${Date.now()}`);

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

describe("global context", () => {
  it("should set and get global context field", async () => {
    await runService.createRun(undefined, undefined, true);
    await contextService.setGlobalContextField("env", "production");
    const result = await contextService.getGlobalContextField("env");
    expect(result.found).toBe(true);
    expect(result.value).toBe("production");
  });

  it("should return not found for missing global key", async () => {
    await runService.createRun(undefined, undefined, true);
    const result = await contextService.getGlobalContextField("missing");
    expect(result.found).toBe(false);
  });

  it("should return empty object for unset global context", async () => {
    await runService.createRun(undefined, undefined, true);
    const ctx = await contextService.getGlobalContext();
    expect(ctx).toEqual({});
  });

  it("should clear global context", async () => {
    await runService.createRun(undefined, undefined, true);
    await contextService.setGlobalContextField("env", "staging");
    await contextService.clearGlobalContext();
    const result = await contextService.getGlobalContextField("env");
    expect(result.found).toBe(false);
  });

  it("should isolate global context per run", async () => {
    const run1 = (await runService.createRun("run1")).id;
    const run2 = (await runService.createRun("run2")).id;

    await contextService.setGlobalContextField("env", "prod", run1);
    await contextService.setGlobalContextField("env", "dev", run2);

    const r1 = await contextService.getGlobalContextField("env", run1);
    const r2 = await contextService.getGlobalContextField("env", run2);
    expect(r1.value).toBe("prod");
    expect(r2.value).toBe("dev");
  });
});

describe("next instruction rendering", () => {
  async function writeNode(name: string, instructions: string): Promise<void> {
    const node = { kind: "Node", name, description: `${name} desc`, instructions };
    await fs.mkdir(path.join(TMP_DIR, ".dagman/nodes"), { recursive: true });
    const yaml = await import("js-yaml");
    await fs.writeFile(
      path.join(TMP_DIR, `.dagman/nodes/${name}.yaml`),
      yaml.dump(node, { lineWidth: -1 })
    );
  }

  async function writeGraph(name: string, edges: { from: string; to: string }[]): Promise<void> {
    const graph = { kind: "Graph", name, edges };
    await fs.mkdir(path.join(TMP_DIR, ".dagman/graphs"), { recursive: true });
    const yaml = await import("js-yaml");
    await fs.writeFile(
      path.join(TMP_DIR, `.dagman/graphs/${name}.yaml`),
      yaml.dump(graph, { lineWidth: -1 })
    );
  }

  it("should render self context variable", async () => {
    await writeNode("alpha", "Deploy from {{dir}}");
    const runId = (await runService.createRun(undefined, "test", true)).id;
    await writeGraph("test", []);

    await contextService.setContextField("alpha", "dir", "/tmp/build", runId);

    const result = await nextService.findNextNode(runId);
    expect(result!.instructions).toBe("Deploy from /tmp/build");
  });

  it("should render global context variable", async () => {
    await writeNode("alpha", "Deploy to {{global.env}}");
    const runId = (await runService.createRun(undefined, "test", true)).id;
    await writeGraph("test", []);

    await contextService.setGlobalContextField("env", "production", runId);

    const result = await nextService.findNextNode(runId);
    expect(result!.instructions).toBe("Deploy to production");
  });

  it("should render upstream node context variable", async () => {
    await writeNode("setup", "Setup project");
    await writeNode("build", "Build using {{setup.tool}}");
    const runId = (await runService.createRun(undefined, "test", true)).id;
    await writeGraph("test", [{ from: "build", to: "setup" }]);

    await stateService.setState("setup", "success", runId);
    await contextService.setContextField("setup", "tool", "webpack", runId);

    const result = await nextService.findNextNode(runId);
    expect(result!.node.name).toBe("build");
    expect(result!.instructions).toBe("Build using webpack");
  });

  it("should render mixed variable sources", async () => {
    await writeNode("setup", "Setup project");
    await writeNode("deploy", "Deploy {{global.project}} from {{setup.output}} to {{env}}");
    const runId = (await runService.createRun(undefined, "test", true)).id;
    await writeGraph("test", [{ from: "deploy", to: "setup" }]);

    await stateService.setState("setup", "success", runId);
    await contextService.setGlobalContextField("project", "dagman", runId);
    await contextService.setContextField("setup", "output", "/dist", runId);
    await contextService.setContextField("deploy", "env", "production", runId);

    const result = await nextService.findNextNode(runId);
    expect(result!.instructions).toBe("Deploy dagman from /dist to production");
  });

  it("should throw error for missing variable", async () => {
    await writeNode("alpha", "Use {{missing-var}}");
    const runId = (await runService.createRun(undefined, "test", true)).id;
    await writeGraph("test", []);

    await expect(nextService.findNextNode(runId)).rejects.toThrow(
      "节点指令中存在未解析的变量"
    );
  });

  it("should not modify instructions without variables", async () => {
    await writeNode("alpha", "Simple task");
    const runId = (await runService.createRun(undefined, "test", true)).id;
    await writeGraph("test", []);

    const result = await nextService.findNextNode(runId);
    expect(result!.instructions).toBe("Simple task");
  });

  it("should preserve code-like syntax in instructions", async () => {
    await writeNode("alpha", "Run: const x = `${process.env.HOME}`; Deploy {{global.target}}");
    const runId = (await runService.createRun(undefined, "test", true)).id;
    await writeGraph("test", []);

    await contextService.setGlobalContextField("target", "prod", runId);

    const result = await nextService.findNextNode(runId);
    expect(result!.instructions).toBe(
      "Run: const x = `${process.env.HOME}`; Deploy prod"
    );
  });
});

describe("import-time variable validation", () => {
  it("should reject reference to non-existent node", async () => {
    const yaml = [
      "kind: Node",
      "name: deploy",
      "description: Deploy",
      "instructions: Use {{ghost.output}}",
      "---",
      "kind: Graph",
      "name: test",
      "edges:",
      "  - from: deploy",
      "    to: ghost",
    ].join("\n");

    await expect(importService.importFromYAML(yaml)).rejects.toThrow(
      ValidationError
    );
  });

  it("should reject reference to non-upstream node", async () => {
    const yaml = [
      "kind: Node",
      "name: setup",
      "description: Setup",
      "instructions: Setup project",
      "---",
      "kind: Node",
      "name: build",
      "description: Build",
      "instructions: Build",
      "---",
      "kind: Node",
      "name: deploy",
      "description: Deploy",
      "instructions: Deploy {{build.output}}",
      "---",
      "kind: Graph",
      "name: test",
      "edges:",
      "  - from: deploy",
      "    to: setup",
    ].join("\n");

    await expect(importService.importFromYAML(yaml)).rejects.toThrow(
      /非上游节点/
    );
  });

  it("should accept reference to valid upstream node", async () => {
    const yaml = [
      "kind: Node",
      "name: setup",
      "description: Setup",
      "instructions: Setup project",
      "---",
      "kind: Node",
      "name: build",
      "description: Build",
      "instructions: Build using {{setup.tool}}",
      "---",
      "kind: Graph",
      "name: test",
      "edges:",
      "  - from: build",
      "    to: setup",
    ].join("\n");

    const result = await importService.importFromYAML(yaml);
    expect(result.importedNodes).toContain("setup");
    expect(result.importedNodes).toContain("build");
  });

  it("should accept global and self references without validation error", async () => {
    const yaml = [
      "kind: Node",
      "name: deploy",
      "description: Deploy",
      "instructions: Deploy {{global.env}} to {{target}}",
      "---",
      "kind: Graph",
      "name: test",
      "edges: []",
    ].join("\n");

    const result = await importService.importFromYAML(yaml);
    expect(result.importedNodes).toContain("deploy");
  });
});
