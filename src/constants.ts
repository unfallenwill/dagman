export const DAGMAN_DIR = ".dagman";
export const NODES_DIR = ".dagman/nodes";
export const GRAPHS_DIR = ".dagman/graphs";
export const RUNS_DIR = ".dagman/runs";
export const CURRENT_RUN_FILE = ".dagman/.current-run";
export const DEFAULT_RUN_ID = "default";

// Legacy paths (kept for migration detection)
export const LEGACY_STATE_FILE = ".dagman/state.json";
export const LEGACY_CONTEXT_DIR = ".dagman/context";

// Run-aware path resolvers
export function getRunDir(runId: string): string {
  return `${RUNS_DIR}/${runId}`;
}

export function getRunMetaFile(runId: string): string {
  return `${RUNS_DIR}/${runId}/run.json`;
}

export function getStateFile(runId: string): string {
  return `${RUNS_DIR}/${runId}/state.json`;
}

export function getContextDir(runId: string): string {
  return `${RUNS_DIR}/${runId}/context`;
}

export function getEventsFile(runId: string): string {
  return `${RUNS_DIR}/${runId}/events.jsonl`;
}
