import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import * as nodeService from "../../src/services/node-service.js";
import { FileExistsError, NodeNotFoundError } from "../../src/errors.js";

const TMP_DIR = path.join(os.tmpdir(), `dagman-test-${Date.now()}`);

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
  it("should create a template file without depends_on", async () => {
    const filePath = await nodeService.createTemplate("my-node");
    expect(filePath).toBe(".dagman/nodes/my-node.yaml");

    const yaml = await import("js-yaml");
    const content = await fs.readFile(
      path.join(TMP_DIR, ".dagman/nodes/my-node.yaml"),
      "utf-8"
    );
    const parsed = yaml.load(content) as Record<string, unknown>;
    expect(parsed.kind).toBe("Node");
    expect(parsed.name).toBe("my-node");
    expect(parsed.description).toBe("");
    expect(parsed).not.toHaveProperty("depends_on");
  });

  it("should throw FileExistsError when node already exists", async () => {
    await nodeService.createTemplate("existing");
    await expect(nodeService.createTemplate("existing")).rejects.toThrow(
      FileExistsError
    );
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

  it("should succeed even without runs directory", async () => {
    await nodeService.createTemplate("ctx-test");
    // No runs directory exists - should not throw
    await nodeService.removeNode("ctx-test");
    await expect(nodeService.getNode("ctx-test")).rejects.toThrow(
      NodeNotFoundError
    );
  });
});

describe("getNode", () => {
  it("should return a node by name", async () => {
    await nodeService.createTemplate("test-node");
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

describe("collectDownstream", () => {
  it("should find nodes that depend on the given node", async () => {
    const { collectDownstream } = await import("../../src/utils/topology.js");
    const edges = [
      { from: "child", to: "parent" },
    ];
    const deps = collectDownstream("parent", edges);
    expect(deps).toEqual(["child"]);
  });

  it("should return empty array when no dependents", async () => {
    const { collectDownstream } = await import("../../src/utils/topology.js");
    const deps = collectDownstream("lonely", []);
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
