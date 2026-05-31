import { promises as fs } from 'fs'
import * as path from 'path'
import type { RunStatus } from '../../shared/models/compiled-graph.js'

const DEFAULT_RUN_ID = 'default'

// ===== Dependency Injection =====

export interface RunResolverDeps {
  getRunMetaFile?: (runId: string) => string
  getCurrentRunFilePath?: () => string
  getRunsDir?: () => string
  getDagmanDir?: () => string
  ensureDir?: (dirPath: string) => Promise<void>
  fileExists?: (filePath: string) => Promise<boolean>
  readJSON?: <T>(filePath: string) => Promise<T>
}

let _defaults: Partial<RunResolverDeps> = {}

/** Set default deps — called by engine/composition root at startup */
export function setDefaultRunResolverDeps(defaults: Partial<RunResolverDeps>): void {
  _defaults = { ..._defaults, ...defaults }
}

function resolveRunResolverDeps(deps?: RunResolverDeps) {
  const merged = { ..._defaults, ...deps }
  return {
    getRunMetaFile: merged.getRunMetaFile!,
    getCurrentRunFilePath: merged.getCurrentRunFilePath!,
    getRunsDir: merged.getRunsDir!,
    getDagmanDir: merged.getDagmanDir!,
    ensureDir: merged.ensureDir!,
    fileExists: merged.fileExists!,
    readJSON: merged.readJSON!,
  }
}

// ===== Functions =====

export async function getCurrentRunId(deps?: RunResolverDeps): Promise<string | null> {
  const d = resolveRunResolverDeps(deps)
  const filePath = d.getCurrentRunFilePath()
  if (!(await d.fileExists(filePath))) {
    return null
  }
  const content = await fs.readFile(path.resolve(filePath), 'utf-8')
  return content.trim() || null
}

export async function setCurrentRunId(runId: string, deps?: RunResolverDeps): Promise<void> {
  const d = resolveRunResolverDeps(deps)
  await d.ensureDir(d.getDagmanDir())
  await fs.writeFile(path.resolve(d.getCurrentRunFilePath()), runId, 'utf-8')
}

export async function resolveCurrentRunId(deps?: RunResolverDeps): Promise<string> {
  const current = await getCurrentRunId(deps)
  if (current) return current
  return DEFAULT_RUN_ID
}

export async function listRunIds(deps?: RunResolverDeps): Promise<string[]> {
  const d = resolveRunResolverDeps(deps)
  const abs = path.resolve(d.getRunsDir())
  try {
    const entries = await fs.readdir(abs)
    const ids: string[] = []
    for (const entry of entries) {
      if (await d.fileExists(d.getRunMetaFile(entry))) {
        ids.push(entry)
      }
    }
    return ids
  } catch {
    return []
  }
}

/**
 * Hybrid auto-resolve for active run ID.
 * 1. First tries `.current-run` file
 * 2. If empty, scans `.dagman/runs/` for runs with status `running`
 * 3. If exactly one, returns it
 * 4. If zero or multiple, throws appropriate error
 */
export async function resolveActiveRunId(deps?: RunResolverDeps): Promise<string> {
  // First try .current-run file
  const current = await getCurrentRunId(deps)
  if (current) {
    return current
  }

  // Scan for running runs
  const runIds = await listRunIds(deps)
  const runningRuns: string[] = []

  for (const runId of runIds) {
    try {
      const d = resolveRunResolverDeps(deps)
      const meta = await d.readJSON<{ status?: RunStatus }>(d.getRunMetaFile(runId))
      if (meta.status === 'running') {
        runningRuns.push(runId)
      }
    } catch {
      // Skip invalid runs
      continue
    }
  }

  if (runningRuns.length === 1) {
    return runningRuns[0]!
  }

  if (runningRuns.length === 0) {
    throw new Error('No active run found. Use `dagman workflow start <name>` to create one.')
  }

  throw new Error(
    `Multiple active runs found: ${runningRuns.join(', ')}. Please specify which one to use with --run <id>.`,
  )
}
