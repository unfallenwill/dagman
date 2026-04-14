import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import * as nodeService from "../../src/services/node-service.js";
import { FileExistsError, NodeNotFoundError, ValidationError } from "../../src/errors.js";

const TMP_DIR = path.join(os.tmpdir(), `dagman-test-${Date.now()}`);
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

describe("createTemplate", () => {
  it("should create a template file", async () => {
    const filePath = await nodeService.createTemplate("my-node");
    expect(filePath).toBe(".dagman/nodes/my-node.json");

    const content = await fs.readFile(
      path.join(TMP_DIR, ".dagman/nodes/my-node.json"),
      "utf-8"
    );
    const parsed = JSON.parse(content);
    expect(parsed.name).toBe("my-node");
    expect(parsed.description).toBe("");
    expect(parsed.states).toEqual(["success", "failed"]);
    expect(parsed.default_state).toBe("success");
    expect(parsed.depends_on).toEqual([]);
  });

  it("should throw FileExistsError when node already exists", async () => {
    await nodeService.createTemplate("existing");
    await expect(nodeService.createTemplate("existing")).rejects.toThrow(
      FileExistsError
    );
  });
});

describe("addNode", () => {
  it("should register a valid node", async () => {
    const node = await nodeService.addNode(
      path.join(FIXTURES, "sample-node.json")
    );
    expect(node.name).toBe("test-node");
    expect(node.states).toEqual(["success", "failed"]);
  });

  it("should throw ValidationError for missing fields", async () => {
    await expect(
      nodeService.addNode(path.join(FIXTURES, "missing-fields-node.json"))
    ).rejects.toThrow(ValidationError);
  });

  it("should throw FileExistsError when node name already registered", async () => {
    await nodeService.addNode(path.join(FIXTURES, "sample-node.json"));
    await expect(
      nodeService.addNode(path.join(FIXTURES, "sample-node.json"))
    ).rejects.toThrow(FileExistsError);
  });
});

describe("removeNode", () => {
  it("should remove a node", async () => {
    await nodeService.createTemplate("to-remove");
    await nodeService.removeNode("to-remove");
    await expect(nodeService.getNode("to-remove")).rejects.toThrow(
      NodeNotFoundError
    );
  });

  it("should throw NodeNotFoundError when node does not exist", async () => {
    await expect(nodeService.removeNode("ghost")).rejects.toThrow(
      NodeNotFoundError
    );
  });

  it("should also delete context file", async () => {
    await nodeService.createTemplate("ctx-test");
    const ctxDir = path.join(TMP_DIR, ".dagman/context");
    await fs.mkdir(ctxDir, { recursive: true });
    await fs.writeFile(
      path.join(ctxDir, "ctx-test.json"),
      '{"key":"value"}'
    );

    await nodeService.removeNode("ctx-test");
    await expect(
      fs.access(path.join(ctxDir, "ctx-test.json"))
    ).rejects.toThrow();
  });
});

describe("getNode", () => {
  it("should return a node by name", async () => {
    await nodeService.addNode(path.join(FIXTURES, "sample-node.json"));
    const node = await nodeService.getNode("test-node");
    expect(node.name).toBe("test-node");
  });

  it("should throw NodeNotFoundError when node does not exist", async () => {
    await expect(nodeService.getNode("ghost")).rejects.toThrow(
      NodeNotFoundError
    );
  });
});

describe("listNodes", () => {
  it("should return all nodes", async () => {
    await nodeService.createTemplate("node-a");
    await nodeService.createTemplate("node-b");
    const nodes = await nodeService.listNodes();
    const names = nodes.map((n) => n.name).sort();
    expect(names).toEqual(["node-a", "node-b"]);
  });

  it("should return empty array when no nodes", async () => {
    const nodes = await nodeService.listNodes();
    expect(nodes).toEqual([]);
  });
});

describe("findDependents", () => {
  it("should find nodes that depend on the given node", async () => {
    await nodeService.createTemplate("parent");
    const child = {
      name: "child",
      description: "child node",
      instructions: "do child work",
      states: ["success"],
      default_state: "success",
      depends_on: ["parent"],
    };
    await fs.mkdir(path.join(TMP_DIR, ".dagman/nodes"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/nodes/child.json"),
      JSON.stringify(child)
    );

    const deps = await nodeService.findDependents("parent");
    expect(deps).toEqual(["child"]);
  });

  it("should return empty array when no dependents", async () => {
    await nodeService.createTemplate("lonely");
    const deps = await nodeService.findDependents("lonely");
    expect(deps).toEqual([]);
  });
});

describe("nodeExists", () => {
  it("should return true when node exists", async () => {
    await nodeService.createTemplate("exists");
    expect(await nodeService.nodeExists("exists")).toBe(true);
  });

  it("should return false when node does not exist", async () => {
    expect(await nodeService.nodeExists("nope")).toBe(false);
  });
});
