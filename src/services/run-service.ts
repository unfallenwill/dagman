import { promises as fs } from "fs";
import * as path from "path";
import {
  RUNS_DIR,
  CURRENT_RUN_FILE,
  DEFAULT_RUN_ID,
  LEGACY_STATE_FILE,
  LEGACY_CONTEXT_DIR,
  getRunDir,
  getRunMetaFile,
  getStateFile,
  getContextDir,
} from "../constants.js";
import { ensureDir, readJSON, writeJSON, fileExists, deleteFile, listFiles } from "../utils/file.js";
import { RunNotFoundError, RunExistsError } from "../errors.js";

export interface RunInfo {
  id: string;
  createdAt: string;
  label?: string;
}

export async function getCurrentRunId(): Promise<string | null> {
  if (!(await fileExists(CURRENT_RUN_FILE))) {
    return null;
  }
  const content = await fs.readFile(path.resolve(CURRENT_RUN_FILE), "utf-8");
  return content.trim() || null;
}

export async function setCurrentRunId(runId: string): Promise<void> {
  await ensureDir(".dagman");
  await fs.writeFile(path.resolve(CURRENT_RUN_FILE), runId, "utf-8");
}

export async function resolveCurrentRunId(): Promise<string> {
  const current = await getCurrentRunId();
  if (current) return current;

  // Check for legacy layout and migrate
  const legacyStateExists = await fileExists(LEGACY_STATE_FILE);
  const legacyContextExists = await fileExists(LEGACY_CONTEXT_DIR);

  if (legacyStateExists || legacyContextExists) {
    await createRunInternal(DEFAULT_RUN_ID, "自动迁移");
    if (legacyStateExists) {
      const stateData = await readJSON<Record<string, string>>(LEGACY_STATE_FILE);
      await writeJSON(getStateFile(DEFAULT_RUN_ID), stateData);
      await deleteFile(LEGACY_STATE_FILE);
    }
    if (legacyContextExists) {
      const files = await listFiles(LEGACY_CONTEXT_DIR);
      for (const file of files) {
        const content = await readJSON(`${LEGACY_CONTEXT_DIR}/${file}`);
        await writeJSON(`${getContextDir(DEFAULT_RUN_ID)}/${file}`, content);
      }
      await fs.rm(path.resolve(LEGACY_CONTEXT_DIR), { recursive: true, force: true });
    }
    await setCurrentRunId(DEFAULT_RUN_ID);
    return DEFAULT_RUN_ID;
  }

  // Fresh start
  await createRunInternal(DEFAULT_RUN_ID);
  await setCurrentRunId(DEFAULT_RUN_ID);
  return DEFAULT_RUN_ID;
}

async function createRunInternal(runId: string, label?: string): Promise<RunInfo> {
  const runDir = getRunDir(runId);
  if (await fileExists(getRunMetaFile(runId))) {
    throw new RunExistsError(runId);
  }

  await ensureDir(runDir);
  await writeJSON(getStateFile(runId), {});
  const info: RunInfo = {
    id: runId,
    createdAt: new Date().toISOString(),
    label,
  };
  await writeJSON(getRunMetaFile(runId), info);
  return info;
}

export async function createRun(label?: string, switchTo?: boolean): Promise<RunInfo> {
  const runId = label
    ? label.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
    : `run-${Date.now()}`;

  if (!runId) {
    throw new Error("无法从标签生成有效的运行 ID");
  }

  const info = await createRunInternal(runId, label);

  if (switchTo) {
    await setCurrentRunId(runId);
  }

  return info;
}

export async function listRuns(): Promise<RunInfo[]> {
  const runs: RunInfo[] = [];
  const abs = path.resolve(RUNS_DIR);

  try {
    const entries = await fs.readdir(abs);
    for (const entry of entries) {
      try {
        const metaFile = getRunMetaFile(entry);
        if (await fileExists(metaFile)) {
          const info = await readJSON<RunInfo>(metaFile);
          runs.push(info);
        }
      } catch {
        // skip invalid runs
      }
    }
  } catch {
    // runs dir doesn't exist
  }

  return runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function switchRun(runId: string): Promise<void> {
  if (!(await fileExists(getRunMetaFile(runId)))) {
    throw new RunNotFoundError(runId);
  }
  await setCurrentRunId(runId);
}

export async function showRun(runId: string): Promise<RunInfo & { stateCount: number }> {
  const metaFile = getRunMetaFile(runId);
  if (!(await fileExists(metaFile))) {
    throw new RunNotFoundError(runId);
  }

  const info = await readJSON<RunInfo>(metaFile);
  const stateFile = getStateFile(runId);
  let stateCount = 0;
  if (await fileExists(stateFile)) {
    const state = await readJSON<Record<string, string>>(stateFile);
    stateCount = Object.keys(state).length;
  }

  return { ...info, stateCount };
}
