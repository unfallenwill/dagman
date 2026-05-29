import { promises as fs } from "fs";
import * as path from "path";
import {
  RUNS_DIR,
  CURRENT_RUN_FILE,
  DEFAULT_RUN_ID,
  getRunMetaFile,
} from "../constants.js";
import { ensureDir, fileExists } from "./file.js";

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
  return DEFAULT_RUN_ID;
}

export async function listRunIds(): Promise<string[]> {
  const abs = path.resolve(RUNS_DIR);
  try {
    const entries = await fs.readdir(abs);
    const ids: string[] = [];
    for (const entry of entries) {
      if (await fileExists(getRunMetaFile(entry))) {
        ids.push(entry);
      }
    }
    return ids;
  } catch {
    return [];
  }
}
