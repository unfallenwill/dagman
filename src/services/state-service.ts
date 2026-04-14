import type { StateMap } from "../models/state.js";
import { STATE_FILE, DAGMAN_DIR } from "../constants.js";
import { readJSON, writeJSON, ensureDir, fileExists } from "../utils/file.js";

export async function getState(): Promise<StateMap> {
  if (!(await fileExists(STATE_FILE))) {
    return {};
  }
  return readJSON<StateMap>(STATE_FILE);
}

export async function setState(nodeName: string, status: string): Promise<void> {
  const state = await getState();
  state[nodeName] = status;
  await ensureDir(DAGMAN_DIR);
  await writeJSON(STATE_FILE, state);
}

export async function initState(nodeName: string, defaultState: string): Promise<void> {
  const state = await getState();
  if (!(nodeName in state)) {
    state[nodeName] = defaultState;
    await ensureDir(DAGMAN_DIR);
    await writeJSON(STATE_FILE, state);
  }
}

export async function removeState(nodeName: string): Promise<void> {
  if (!(await fileExists(STATE_FILE))) {
    return;
  }
  const state = await getState();
  delete state[nodeName];
  await writeJSON(STATE_FILE, state);
}
