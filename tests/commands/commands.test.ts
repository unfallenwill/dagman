import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { Command } from "commander";
import { registerHelpCommand } from "../../src/commands/help.js";
import { registerLsCommand } from "../../src/commands/ls.js";
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
  registerLsCommand(program);
  return program;
}

describe("workflow commands", () => {
  it("should list empty workflows", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "dagman", "ls"]);
  });
});

describe("task commands", () => {
  it("should list tasks for a workflow run", async () => {
    // Setup: create compiled graph and run
    await fs.mkdir(path.join(TMP_DIR, ".dagman/graphs"), { recursive: true });
    const graphData = {
      name: "test",
      edges: [{ from: "node-b", to: "node-a" }],
      nodes: [
        { name: "node-a", description: "test", instructions: "test", kind: "user" },
        { name: "node-b", description: "test", instructions: "test", kind: "user" }
      ]
    };
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/graphs/test.json"),
      JSON.stringify(graphData, null, 2)
    );

    const info = await runService.createRun("task-test", "test", true);
    expect(info.graphName).toBe("test");

    // List tasks
    const tasks = await workflowService.listTasks(undefined, info.id);
    expect(tasks.length).toBe(1); // Only node-a is in layer 0
    expect(tasks[0].nodeId).toBe("node-a");
    expect(tasks[0].status).toBe("ready");
  });
});
