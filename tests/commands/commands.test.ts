import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { Command } from "commander";
import { registerNodeCommand } from "../../src/commands/node.js";
import { registerGraphCommand } from "../../src/commands/graph.js";
import { registerHelpCommand } from "../../src/commands/help.js";
import { registerChannelCommand } from "../../src/commands/channel.js";
import { registerTaskCommand } from "../../src/commands/task.js";
import { registerStepCommand } from "../../src/commands/step.js";
import * as runService from "../../src/runtime/run.js";
import * as workflowService from "../../src/workflow/workflow.js";

const TMP_DIR = path.join(os.tmpdir(), `dagman-cmd-test-${Date.now()}`);

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

function createProgram(): Command {
  const program = new Command();
  program.exitOverride(); // prevent process.exit from killing test
  program.configureOutput({
    writeErr: () => {},
  });
  registerHelpCommand(program);
  registerNodeCommand(program);
  registerGraphCommand(program);
  registerChannelCommand(program);
  registerTaskCommand(program);
  registerStepCommand(program);
  return program;
}

describe("node create command", () => {
  it("should create a node template", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "dagman", "node", "create", "my-node"]);

    const exists = await fs
      .access(path.join(TMP_DIR, ".dagman/nodes/my-node.yaml"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it("should fail when node already exists", async () => {
    const program1 = createProgram();
    await program1.parseAsync(["node", "dagman", "node", "create", "dup"]);

    const program2 = createProgram();
    await expect(
      program2.parseAsync(["node", "dagman", "node", "create", "dup"])
    ).rejects.toThrow();
  });
});

describe("graph commands", () => {
  it("should list empty graphs", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "dagman", "graph", "list"]);
  });
});

describe("task commands", () => {
  it("should list tasks for a workflow run", async () => {
    // Setup: create nodes, graph, and run
    const yaml = await import("js-yaml");
    await fs.mkdir(path.join(TMP_DIR, ".dagman/nodes"), { recursive: true });

    for (const name of ["node-a", "node-b"]) {
      await fs.writeFile(
        path.join(TMP_DIR, `.dagman/nodes/${name}.yaml`),
        yaml.dump({ kind: "Node", name, description: "test", instructions: "test" }, { lineWidth: -1 })
      );
    }

    await fs.mkdir(path.join(TMP_DIR, ".dagman/graphs"), { recursive: true });
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/graphs/test.yaml"),
      yaml.dump({
        kind: "Graph",
        name: "test",
        edges: [{ from: "node-b", to: "node-a" }],
      }, { lineWidth: -1 })
    );

    const info = await runService.createRun("task-test", "test", true);
    expect(info.graphName).toBe("test");

    // List tasks
    const tasks = await workflowService.listTasks(undefined, "task-test");
    expect(tasks.length).toBe(1); // Only node-a is in layer 0
    expect(tasks[0].nodeId).toBe("node-a");
    expect(tasks[0].status).toBe("ready");
  });
});

describe("channel commands", () => {
  it("should set and get a channel", async () => {
    // Setup: create a run with workflow
    const yaml = await import("js-yaml");
    await fs.mkdir(path.join(TMP_DIR, ".dagman/nodes"), { recursive: true });
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/nodes/test-node.yaml"),
      yaml.dump({ kind: "Node", name: "test-node", description: "test", instructions: "test" }, { lineWidth: -1 })
    );

    await fs.mkdir(path.join(TMP_DIR, ".dagman/graphs"), { recursive: true });
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/graphs/single.yaml"),
      yaml.dump({ kind: "Graph", name: "single", edges: [] }, { lineWidth: -1 })
    );

    await runService.createRun("ch-test", "single", true);

    // Set channel
    const ch = await workflowService.setChannel("test-node.mykey", "myvalue", "ch-test");
    expect(ch.version).toBe(1);
    expect(ch.value).toBe("myvalue");

    // Get channel
    const retrieved = await workflowService.getChannel("test-node.mykey", "ch-test");
    expect(retrieved?.value).toBe("myvalue");
    expect(retrieved?.version).toBe(1);
  });
});
