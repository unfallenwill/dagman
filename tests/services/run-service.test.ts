import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import * as runService from "../../src/services/run-service.js";
import { RunNotFoundError, RunExistsError } from "../../src/errors.js";

const TMP_DIR = path.join(os.tmpdir(), `dagman-run-test-${Date.now()}`);

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

describe("resolveCurrentRunId", () => {
  it("should auto-create default run when no current run", async () => {
    const runId = await runService.resolveCurrentRunId();
    expect(runId).toBe("default");

    // Should have created the run structure
    const metaExists = await fs
      .access(path.join(TMP_DIR, ".dagman/runs/default/run.json"))
      .then(() => true)
      .catch(() => false);
    expect(metaExists).toBe(true);

    // Should have set .current-run
    const currentRun = await fs.readFile(
      path.join(TMP_DIR, ".dagman/.current-run"),
      "utf-8"
    );
    expect(currentRun.trim()).toBe("default");
  });

  it("should return existing current run", async () => {
    await fs.mkdir(path.join(TMP_DIR, ".dagman"), { recursive: true });
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/.current-run"),
      "my-run"
    );

    const runId = await runService.resolveCurrentRunId();
    expect(runId).toBe("my-run");
  });

  it("should migrate legacy state.json to runs/default", async () => {
    await fs.mkdir(path.join(TMP_DIR, ".dagman"), { recursive: true });
    await fs.writeFile(
      path.join(TMP_DIR, ".dagman/state.json"),
      JSON.stringify({ "node-a": "success" })
    );

    const runId = await runService.resolveCurrentRunId();
    expect(runId).toBe("default");

    // Legacy state should be moved
    const legacyExists = await fs
      .access(path.join(TMP_DIR, ".dagman/state.json"))
      .then(() => true)
      .catch(() => false);
    expect(legacyExists).toBe(false);

    // State should be in new location
    const state = JSON.parse(
      await fs.readFile(
        path.join(TMP_DIR, ".dagman/runs/default/state.json"),
        "utf-8"
      )
    );
    expect(state["node-a"]).toBe("success");
  });
});

describe("createRun", () => {
  it("should create a run with label-based ID", async () => {
    const info = await runService.createRun("My Feature");
    expect(info.id).toBe("my-feature");
    expect(info.label).toBe("My Feature");
  });

  it("should create a run with auto-generated ID when no label", async () => {
    const info = await runService.createRun();
    expect(info.id).toMatch(/^run-\d+$/);
  });

  it("should throw RunExistsError for duplicate ID", async () => {
    await runService.createRun("duplicate");
    await expect(runService.createRun("duplicate")).rejects.toThrow(
      RunExistsError
    );
  });

  it("should switch to new run when switchTo is true", async () => {
    await runService.createRun("feature-x", true);
    const currentId = await runService.getCurrentRunId();
    expect(currentId).toBe("feature-x");
  });
});

describe("listRuns", () => {
  it("should list all runs", async () => {
    await runService.createRun("alpha");
    await runService.createRun("beta");

    const runs = await runService.listRuns();
    const ids = runs.map((r) => r.id).sort();
    expect(ids).toEqual(["alpha", "beta"]);
  });

  it("should return empty array when no runs", async () => {
    const runs = await runService.listRuns();
    expect(runs).toEqual([]);
  });
});

describe("switchRun", () => {
  it("should switch to existing run", async () => {
    await runService.createRun("target");
    await runService.switchRun("target");
    const currentId = await runService.getCurrentRunId();
    expect(currentId).toBe("target");
  });

  it("should throw RunNotFoundError for non-existent run", async () => {
    await expect(runService.switchRun("ghost")).rejects.toThrow(
      RunNotFoundError
    );
  });
});

describe("showRun", () => {
  it("should return run info with state count", async () => {
    await runService.createRun("info-test");
    // Write some state manually
    const stateDir = path.join(TMP_DIR, ".dagman/runs/info-test");
    await fs.writeFile(
      path.join(stateDir, "state.json"),
      JSON.stringify({ "node-a": "success", "node-b": "failed" })
    );

    const info = await runService.showRun("info-test");
    expect(info.id).toBe("info-test");
    expect(info.stateCount).toBe(2);
  });

  it("should throw RunNotFoundError for non-existent run", async () => {
    await expect(runService.showRun("ghost")).rejects.toThrow(RunNotFoundError);
  });
});
