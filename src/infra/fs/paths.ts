import * as path from 'path'
import { fileExists } from './file-ops.js'

// --- Path constants (relative, never exported directly for path resolution) ---

export const DAGMAN_DIR = '.dagman'
export const GRAPHS_DIR = '.dagman/graphs'
export const RUNS_DIR = '.dagman/runs'
export const WORKFLOWS_DIR = '.dagman/workflows'
export const CURRENT_RUN_FILE = '.dagman/.current-run'
export const DEFAULT_RUN_ID = 'default'

// --- Base path injection ---

let basePath = ''

/** Set the base directory for all dagman path resolution. Replaces process.cwd() dependency. */
export function setBasePath(dir: string): void {
  basePath = dir
}

/** Get the current base path (empty string means resolve via process.cwd()). */
export function getBasePath(): string {
  return basePath
}

/** Resolve a relative dagman path against basePath (or leave relative if basePath is unset). */
function resolve(relativePath: string): string {
  return basePath ? path.join(basePath, relativePath) : relativePath
}

// --- Directory-level resolvers ---

export function getDagmanDir(): string {
  return resolve(DAGMAN_DIR)
}

export function getRunsDir(): string {
  return resolve(RUNS_DIR)
}

export function getGraphsDir(): string {
  return resolve(GRAPHS_DIR)
}

export function getWorkflowsDir(): string {
  return resolve(WORKFLOWS_DIR)
}

export function getCurrentRunFilePath(): string {
  return resolve(CURRENT_RUN_FILE)
}

// --- Run-aware path resolvers ---

export function getRunDir(runId: string): string {
  return resolve(`${RUNS_DIR}/${runId}`)
}

export function getRunMetaFile(runId: string): string {
  return resolve(`${RUNS_DIR}/${runId}/run.json`)
}

export function getWorkflowJsonlFile(runId: string): string {
  return resolve(`${RUNS_DIR}/${runId}/workflow.jsonl`)
}

export function getEventsFile(runId: string): string {
  return resolve(`${RUNS_DIR}/${runId}/events.jsonl`)
}

// --- Workflow path resolvers ---

export function getWorkflowDir(name: string): string {
  return resolve(`${WORKFLOWS_DIR}/${name}`)
}

export function getWorkflowTsFile(name: string): string {
  return resolve(`${WORKFLOWS_DIR}/${name}/index.ts`)
}

export function getWorkflowManifest(name: string): string {
  return resolve(`${WORKFLOWS_DIR}/${name}/manifest.yaml`)
}

/**
 * Get workflow entry file, checking index.ts first, then index.js.
 * This supports both TS and compiled JS workflows.
 */
export async function getWorkflowEntryFile(name: string): Promise<string> {
  const tsFile = getWorkflowTsFile(name)
  const jsFile = resolve(`${WORKFLOWS_DIR}/${name}/index.js`)

  if (await fileExists(tsFile)) {
    return tsFile
  }
  return jsFile
}
