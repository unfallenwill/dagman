import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { Command } from "commander";
import { registerNodeCommand } from "../../src/commands/node.js";
import { registerStatusCommand } from "../../src/commands/status.js";
import { registerContextCommand } from "../../src/commands/context.js";
import { registerGraphCommand } from "../../src/commands/graph.js";
import { registerHelpCommand } from "../../src/commands/help.js";

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
  registerStatusCommand(program);
  registerContextCommand(program);
  registerGraphCommand(program);
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

describe("status command", () => {
  it("should update node state", async () => {
    // Setup: create node definition and run structure
    const node = {
      kind: "Node",
      name: "changer",
      description: "test",
      instructions: "test",
    };
    await fs.mkdir(path.join(TMP_DIR, ".dagman/nodes"), { recursive: true });
    const yaml = await import("js-yaml");
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/nodes/changer.yaml"),
      yaml.dump(node, { lineWidth: -1 })
    );
    await fs.mkdir(path.join(TMP_DIR, ".dagman/runs/default"), { recursive: true });
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/runs/default/state.json"),
      JSON.stringify({ changer: "success" })
    );
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/.current-run"),
      "default"
    );

    const program = createProgram();
    await program.parseAsync(["node", "dagman", "status", "set", "changer", "failed"]);

    const state = JSON.parse(
      await fs.readFile(
        path.join(TMP_DIR, ".dagman/runs/default/state.json"),
        "utf-8"
      )
    );
    expect(state.changer).toBe("failed");
  });

  it("should fail for invalid status", async () => {
    const node = {
      kind: "Node",
      name: "strict",
      description: "test",
      instructions: "test",
    };
    await fs.mkdir(path.join(TMP_DIR, ".dagman/nodes"), {
      recursive: true,
    });
    const yaml = await import("js-yaml");
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/nodes/strict.yaml"),
      yaml.dump(node, { lineWidth: -1 })
    );
    await fs.mkdir(path.join(TMP_DIR, ".dagman/runs/default"), { recursive: true });
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/.current-run"),
      "default"
    );

    const program = createProgram();
    await expect(
      program.parseAsync(["node", "dagman", "status", "set", "strict", "invalid"])
    ).rejects.toThrow();
  });
});

describe("context commands", () => {
  beforeEach(async () => {
    const node = {
      kind: "Node",
      name: "ctx-node",
      description: "test",
      instructions: "test",
    };
    await fs.mkdir(path.join(TMP_DIR, ".dagman/nodes"), {
      recursive: true,
    });
    const yaml = await import("js-yaml");
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/nodes/ctx-node.yaml"),
      yaml.dump(node, { lineWidth: -1 })
    );
    await fs.mkdir(path.join(TMP_DIR, ".dagman/runs/default"), { recursive: true });
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/.current-run"),
      "default"
    );
  });

  it("should show empty context", async () => {
    const program = createProgram();
    // Should not throw
    await program.parseAsync(["node", "dagman", "context", "show", "ctx-node"]);
  });

  it("should set and get context", async () => {
    const setProgram = createProgram();
    await setProgram.parseAsync([
      "node", "dagman", "context", "set", "ctx-node", "mykey", "myvalue",
    ]);

    const getProgram = createProgram();
    await getProgram.parseAsync([
      "node", "dagman", "context", "get", "ctx-node", "mykey",
    ]);
  });

  it("should clear context", async () => {
    // Set first
    const setProgram = createProgram();
    await setProgram.parseAsync([
      "node", "dagman", "context", "set", "ctx-node", "k", "v",
    ]);

    const clearProgram = createProgram();
    await clearProgram.parseAsync([
      "node", "dagman", "context", "clear", "ctx-node",
    ]);

    // Context file should be gone
    const exists = await fs
      .access(path.join(TMP_DIR, ".dagman/runs/default/context/ctx-node.json"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });
});

describe("graph commands", () => {
  it("should list empty graphs", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "dagman", "graph", "list"]);
  });
});
