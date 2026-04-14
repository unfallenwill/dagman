import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import * as nextService from "../../src/services/next-service.js";
import * as nodeService from "../../src/services/node-service.js";
import * as stateService from "../../src/services/state-service.js";
import * as runService from "../../src/services/run-service.js";

const TMP_DIR = path.join(os.tmpdir(), `dagman-next-test-${Date.now()}`);

let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  await fs.mkdir(TMP_DIR, { recursive: true });
  process.chdir(TMP_DIR);
  // Create a default run
  await runService.createRun("test", true);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await fs.rm(TMP_DIR, { recursive: true, force: true });
});

async function writeNode(name: string, dependsOn: string[] = []): Promise<void> {
  const node = {
    name,
    description: `${name} desc`,
    instructions: `${name} instructions`,
    depends_on: dependsOn,
  };
  await fs.mkdir(path.join(TMP_DIR, ".dagman/nodes"), { recursive: true });
  await fs.writeFile(
    path.join(TMP_DIR, `.dagman/nodes/${name}.json`),
    JSON.stringify(node)
  );
}

describe("findNextNode", () => {
  it("should return first node with no dependencies", async () => {
    await writeNode("alpha");
    await writeNode("beta");

    const result = await nextService.findNextNode();
    expect(result).not.toBeNull();
    expect(result!.node.name).toBe("alpha");
  });

  it("should skip nodes with state already set", async () => {
    await writeNode("alpha");
    await writeNode("beta");

    await stateService.setState("alpha", "success");

    const result = await nextService.findNextNode();
    expect(result!.node.name).toBe("beta");
  });

  it("should skip node whose dependency is not satisfied", async () => {
    await writeNode("alpha");
    await writeNode("beta", ["alpha"]);

    // alpha has no state yet, so beta's dep (alpha:success) is not satisfied
    // but alpha itself IS actionable
    const result = await nextService.findNextNode();
    expect(result!.node.name).toBe("alpha");
  });

  it("should return dependent node after dependency completed", async () => {
    await writeNode("alpha");
    await writeNode("beta", ["alpha"]);

    await stateService.setState("alpha", "success");

    const result = await nextService.findNextNode();
    expect(result!.node.name).toBe("beta");
  });

  it("should return null when all nodes have state", async () => {
    await writeNode("alpha");
    await stateService.setState("alpha", "success");

    const result = await nextService.findNextNode();
    expect(result).toBeNull();
  });

  it("should return null when no nodes exist", async () => {
    const result = await nextService.findNextNode();
    expect(result).toBeNull();
  });

  it("should handle diamond dependency graph", async () => {
    await writeNode("analyze");
    await writeNode("design", ["analyze"]);
    await writeNode("code", ["design"]);
    await writeNode("test", ["code"]);

    // Step 1: analyze is actionable
    let result = await nextService.findNextNode();
    expect(result!.node.name).toBe("analyze");

    await stateService.setState("analyze", "success");

    // Step 2: design is actionable
    result = await nextService.findNextNode();
    expect(result!.node.name).toBe("design");

    await stateService.setState("design", "success");

    // Step 3: code is actionable
    result = await nextService.findNextNode();
    expect(result!.node.name).toBe("code");

    await stateService.setState("code", "success");

    // Step 4: test is actionable
    result = await nextService.findNextNode();
    expect(result!.node.name).toBe("test");

    await stateService.setState("test", "success");

    // All done
    result = await nextService.findNextNode();
    expect(result).toBeNull();
  });

  it("should handle parallel dependencies", async () => {
    await writeNode("design");
    await writeNode("write-code", ["design"]);
    await writeNode("write-tests", ["design"]);
    await writeNode("run-tests", ["write-code", "write-tests"]);

    await stateService.setState("design", "success");

    // write-code and write-tests both actionable; sorted alphabetically
    let result = await nextService.findNextNode();
    expect(result!.node.name).toBe("write-code");

    await stateService.setState("write-code", "success");

    // write-tests still actionable
    result = await nextService.findNextNode();
    expect(result!.node.name).toBe("write-tests");

    // run-tests not yet — write-tests not done
    await stateService.setState("write-tests", "success");

    result = await nextService.findNextNode();
    expect(result!.node.name).toBe("run-tests");
  });

  it("should include upstream context in result", async () => {
    await writeNode("alpha");
    await writeNode("beta", ["alpha"]);

    await stateService.setState("alpha", "success");
    const { setContextField } = await import("../../src/services/context-service.js");
    await setContextField("alpha", "output", "analysis-result");

    const result = await nextService.findNextNode();
    expect(result!.upstreamContext["alpha"]).toEqual({
      output: "analysis-result",
    });
  });

  it("should respect specific run ID", async () => {
    await writeNode("alpha");

    // Default run: alpha has state
    await stateService.setState("alpha", "success");

    // Create another run: alpha has no state
    await runService.createRun("other");
    // Don't switch — pass runId explicitly

    const result = await nextService.findNextNode("other");
    expect(result!.node.name).toBe("alpha");
  });

  it("should treat skipped as satisfying success dependency", async () => {
    await writeNode("alpha");
    await writeNode("beta", ["alpha"]);

    // Skip alpha instead of success
    await stateService.setState("alpha", "skipped");

    const result = await nextService.findNextNode();
    expect(result!.node.name).toBe("beta");
  });

  it("should not activate downstream when dependency failed", async () => {
    await writeNode("alpha");
    await writeNode("beta", ["alpha"]);

    await stateService.setState("alpha", "failed");

    const result = await nextService.findNextNode();
    expect(result).toBeNull();
  });
});
