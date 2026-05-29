export const DAGMAN_DIR = ".dagman";
export const NODES_DIR = ".dagman/nodes";
export const GRAPHS_DIR = ".dagman/graphs";
export const RUNS_DIR = ".dagman/runs";
export const WORKFLOWS_DIR = ".dagman/workflows";
export const CURRENT_RUN_FILE = ".dagman/.current-run";
export const DEFAULT_RUN_ID = "default";

// Legacy paths (kept until old services are removed in Phase 4)
export const LEGACY_STATE_FILE = ".dagman/state.json";
export const LEGACY_CONTEXT_DIR = ".dagman/context";

// Run-aware path resolvers
export function getRunDir(runId: string): string {
  return `${RUNS_DIR}/${runId}`;
}

export function getRunMetaFile(runId: string): string {
  return `${RUNS_DIR}/${runId}/run.json`;
}

export function getWorkflowJsonlFile(runId: string): string {
  return `${RUNS_DIR}/${runId}/workflow.jsonl`;
}

// Legacy path resolvers (kept until old services are removed in Phase 4)
export function getStateFile(runId: string): string {
  return `${RUNS_DIR}/${runId}/state.json`;
}

export function getContextDir(runId: string): string {
  return `${RUNS_DIR}/${runId}/context`;
}

export function getEventsFile(runId: string): string {
  return `${RUNS_DIR}/${runId}/events.jsonl`;
}

// Workflow path resolvers
export function getWorkflowDir(name: string): string {
  return `${WORKFLOWS_DIR}/${name}`;
}

export function getWorkflowTsFile(name: string): string {
  return `${WORKFLOWS_DIR}/${name}/${name}.ts`;
}

export function getWorkflowManifest(name: string): string {
  return `${WORKFLOWS_DIR}/${name}/manifest.yaml`;
}
