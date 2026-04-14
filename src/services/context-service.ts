import type { ContextData } from "../models/context.js";
import { getContextDir } from "../constants.js";
import { readJSON, writeJSON, deleteFile, ensureDir } from "../utils/file.js";
import { resolveCurrentRunId } from "./run-service.js";

async function resolveRun(runId?: string): Promise<string> {
  if (runId) return runId;
  return resolveCurrentRunId();
}

export async function getContext(nodeName: string, runId?: string): Promise<ContextData> {
  const rid = await resolveRun(runId);
  try {
    return await readJSON<ContextData>(`${getContextDir(rid)}/${nodeName}.json`);
  } catch {
    return {};
  }
}

export async function setContextField(
  nodeName: string,
  key: string,
  value: string,
  runId?: string
): Promise<void> {
  const rid = await resolveRun(runId);
  const context = await getContext(nodeName, rid);
  context[key] = value;
  const ctxDir = getContextDir(rid);
  await ensureDir(ctxDir);
  await writeJSON(`${ctxDir}/${nodeName}.json`, context);
}

export async function getContextField(
  nodeName: string,
  key: string,
  runId?: string
): Promise<{ found: boolean; value?: string }> {
  const rid = await resolveRun(runId);
  const context = await getContext(nodeName, rid);
  if (key in context) {
    return { found: true, value: String(context[key]) };
  }
  return { found: false };
}

export async function clearContext(nodeName: string, runId?: string): Promise<void> {
  const rid = await resolveRun(runId);
  await deleteFile(`${getContextDir(rid)}/${nodeName}.json`);
}
