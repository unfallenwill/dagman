import { existsSync } from 'fs'
import * as os from 'os'
import * as path from 'path'

// --- Path constants (relative, never exported directly for path resolution) ---

export const DAGMAN_DIR = '.dagman'
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

// --- Global workflows directory ---

/** Get the global workflows directory ($HOME/.dagman/workflows). */
export function getGlobalWorkflowsDir(): string {
  return path.join(os.homedir(), WORKFLOWS_DIR)
}

/** Return both workflow directories: [local, global]. Local first (takes priority). */
export function getWorkflowsDirs(): string[] {
  return [getWorkflowsDir(), getGlobalWorkflowsDir()]
}

/**
 * Resolve a workflow-relative path by checking local first, then global.
 * Uses sync existsSync (acceptable for CLI tool, not server).
 * Rejects path traversal attempts (e.g., ".." segments).
 */
export function resolveWorkflowPathSync(relativePath: string): string {
  if (relativePath.includes('..')) {
    throw new Error(`invalid workflow path: ${relativePath}`)
  }

  const localPath = resolve(`${WORKFLOWS_DIR}/${relativePath}`)
  if (existsSync(localPath)) return localPath

  const globalPath = path.join(getGlobalWorkflowsDir(), relativePath)
  if (existsSync(globalPath)) return globalPath

  return localPath // fallback: let caller produce the proper error
}

// --- Workflow path resolvers ---

export function getWorkflowDir(name: string): string {
  return resolve(`${WORKFLOWS_DIR}/${name}`)
}

export function getWorkflowTsFile(name: string): string {
  return resolve(`${WORKFLOWS_DIR}/${name}/index.ts`)
}
