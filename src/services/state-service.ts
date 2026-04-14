import type { StateMap } from "../models/state.js";
import { getStateFile } from "../constants.js";
import { readJSON, writeJSON, ensureDir, fileExists } from "../utils/file.js";
import { resolveCurrentRunId } from "./run-service.js";

async function resolveRun(runId?: string): Promise<string> {
  if (runId) return runId;
  return resolveCurrentRunId();
}

export async function getState(runId?: string): Promise<StateMap> {
  const rid = await resolveRun(runId);
  const stateFile = getStateFile(rid);
  if (!(await fileExists(stateFile))) {
    return {};
  }
  return readJSON<StateMap>(stateFile);
}

export async function setState(nodeName: string, status: string, runId?: string): Promise<void> {
  const rid = await resolveRun(runId);
  const state = await getState(rid);
  state[nodeName] = status;
  const stateFile = getStateFile(rid);
  await ensureDir(`.dagman/runs/${rid}`);
  await writeJSON(stateFile, state);
}

export async function initState(nodeName: string, defaultState: string, runId?: string): Promise<void> {
  const rid = await resolveRun(runId);
  const state = await getState(rid);
  if (!(nodeName in state)) {
    state[nodeName] = defaultState;
    const stateFile = getStateFile(rid);
    await ensureDir(`.dagman/runs/${rid}`);
    await writeJSON(stateFile, state);
  }
}

export async function removeState(nodeName: string, runId?: string): Promise<void> {
  const rid = await resolveRun(runId);
  const stateFile = getStateFile(rid);
  if (!(await fileExists(stateFile))) {
    return;
  }
  const state = await getState(rid);
  delete state[nodeName];
  await writeJSON(stateFile, state);
}
