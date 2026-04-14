import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { Command } from "commander";
import { registerCreateCommand } from "../../src/commands/create.js";
import { registerAddCommand } from "../../src/commands/add.js";
import { registerRemoveCommand } from "../../src/commands/remove.js";
import { registerChangeCommand } from "../../src/commands/change.js";
import { registerContextCommand } from "../../src/commands/context.js";
import { registerGraphCommand } from "../../src/commands/graph.js";
import { registerHelpCommand } from "../../src/commands/help.js";

const TMP_DIR = path.join(os.tmpdir(), `dagman-cmd-test-${Date.now()}`);
const FIXTURES = path.resolve(__dirname, "../fixtures");

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
  registerCreateCommand(program);
  registerAddCommand(program);
  registerRemoveCommand(program);
  registerChangeCommand(program);
  registerContextCommand(program);
  registerGraphCommand(program);
  return program;
}

describe("create command", () => {
  it("should create a node template", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "dagman", "create", "my-node"]);

    const content = await fs.readFile(
      path.join(TMP_DIR, ".dagman/nodes/my-node.json"),
      "utf-8"
    );
    const parsed = JSON.parse(content);
    expect(parsed.name).toBe("my-node");
  });

  it("should fail when node already exists", async () => {
    const program1 = createProgram();
    await program1.parseAsync(["node", "dagman", "create", "dup"]);

    const program2 = createProgram();
    await expect(
      program2.parseAsync(["node", "dagman", "create", "dup"])
    ).rejects.toThrow();
  });
});

describe("add command", () => {
  it("should register a valid node", async () => {
    const program = createProgram();
    await program.parseAsync([
      "node",
      "dagman",
      "add",
      path.join(FIXTURES, "sample-node.json"),
    ]);

    const exists = await fs
      .access(path.join(TMP_DIR, ".dagman/nodes/test-node.json"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    const state = JSON.parse(
      await fs.readFile(
        path.join(TMP_DIR, ".dagman/state.json"),
        "utf-8"
      )
    );
    expect(state["test-node"]).toBe("success");
  });

  it("should fail for invalid node file", async () => {
    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "dagman",
        "add",
        path.join(FIXTURES, "missing-fields-node.json"),
      ])
    ).rejects.toThrow();
  });
});

describe("change command", () => {
  it("should update node state", async () => {
    // First create and add a node
    const setup = createProgram();
    await setup.parseAsync(["node", "dagman", "create", "changer"]);
    // Add needs a valid file, so write one manually
    const node = {
      name: "changer",
      description: "test",
      instructions: "test",
      states: ["success", "failed"],
      default_state: "success",
      depends_on: [],
    };
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/nodes/changer.json"),
      JSON.stringify(node)
    );
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/state.json"),
      JSON.stringify({ changer: "success" })
    );

    const program = createProgram();
    await program.parseAsync([
      "node",
      "dagman",
      "change",
      "changer",
      "failed",
    ]);

    const state = JSON.parse(
      await fs.readFile(
        path.join(TMP_DIR, ".dagman/state.json"),
        "utf-8"
      )
    );
    expect(state.changer).toBe("failed");
  });

  it("should fail for invalid status", async () => {
    const node = {
      name: "strict",
      description: "test",
      instructions: "test",
      states: ["success"],
      default_state: "success",
      depends_on: [],
    };
    await fs.mkdir(path.join(TMP_DIR, ".dagman/nodes"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/nodes/strict.json"),
      JSON.stringify(node)
    );

    const program = createProgram();
    await expect(
      program.parseAsync([
        "node",
        "dagman",
        "change",
        "strict",
        "invalid",
      ])
    ).rejects.toThrow();
  });
});

describe("context commands", () => {
  beforeEach(async () => {
    const node = {
      name: "ctx-node",
      description: "test",
      instructions: "test",
      states: ["success"],
      default_state: "success",
      depends_on: [],
    };
    await fs.mkdir(path.join(TMP_DIR, ".dagman/nodes"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/nodes/ctx-node.json"),
      JSON.stringify(node)
    );
  });

  it("should show empty context", async () => {
    const program = createProgram();
    // Should not throw
    await program.parseAsync([
      "node",
      "dagman",
      "context",
      "ctx-node",
    ]);
  });

  it("should set and get context", async () => {
    const setProgram = createProgram();
    await setProgram.parseAsync([
      "node",
      "dagman",
      "context",
      "set",
      "ctx-node",
      "mykey",
      "myvalue",
    ]);

    const getProgram = createProgram();
    await getProgram.parseAsync([
      "node",
      "dagman",
      "context",
      "get",
      "ctx-node",
      "mykey",
    ]);
  });

  it("should clear context", async () => {
    // Set first
    const setProgram = createProgram();
    await setProgram.parseAsync([
      "node",
      "dagman",
      "context",
      "set",
      "ctx-node",
      "k",
      "v",
    ]);

    const clearProgram = createProgram();
    await clearProgram.parseAsync([
      "node",
      "dagman",
      "context",
      "clear",
      "ctx-node",
    ]);

    // Context file should be gone
    const exists = await fs
      .access(path.join(TMP_DIR, ".dagman/context/ctx-node.json"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });
});

describe("graph commands", () => {
  it("should show empty graph", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "dagman", "graph", "show"]);
  });

  it("should validate empty graph", async () => {
    const program = createProgram();
    await program.parseAsync(["node", "dagman", "graph", "validator"]);
  });
});
