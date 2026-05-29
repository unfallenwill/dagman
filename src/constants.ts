import { fileExists } from './utils/file.js'

export const DAGMAN_DIR = '.dagman'
export const GRAPHS_DIR = '.dagman/graphs'
export const RUNS_DIR = '.dagman/runs'
export const WORKFLOWS_DIR = '.dagman/workflows'
export const CURRENT_RUN_FILE = '.dagman/.current-run'
export const DEFAULT_RUN_ID = 'default'

// Run-aware path resolvers
export function getRunDir(runId: string): string {
  return `${RUNS_DIR}/${runId}`
}

export function getRunMetaFile(runId: string): string {
  return `${RUNS_DIR}/${runId}/run.json`
}

export function getWorkflowJsonlFile(runId: string): string {
  return `${RUNS_DIR}/${runId}/workflow.jsonl`
}

export function getEventsFile(runId: string): string {
  return `${RUNS_DIR}/${runId}/events.jsonl`
}

// Workflow path resolvers
export function getWorkflowDir(name: string): string {
  return `${WORKFLOWS_DIR}/${name}`
}

export function getWorkflowTsFile(name: string): string {
  return `${WORKFLOWS_DIR}/${name}/index.ts`
}

export function getWorkflowManifest(name: string): string {
  return `${WORKFLOWS_DIR}/${name}/manifest.yaml`
}

/**
 * Get workflow entry file, checking index.ts first, then index.js.
 * This supports both TS and compiled JS workflows.
 */
export async function getWorkflowEntryFile(name: string): Promise<string> {
  const tsFile = `${WORKFLOWS_DIR}/${name}/index.ts`
  const jsFile = `${WORKFLOWS_DIR}/${name}/index.js`

  if (await fileExists(tsFile)) {
    return tsFile
  }
  return jsFile
}
