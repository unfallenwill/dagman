import { promises as fs } from 'fs'
import * as path from 'path'
import { RunNotFoundError } from '../../shared/errors.js'
import type { RunInfo, RunStatus } from '../../shared/models/compiled-graph.js'
import type { CompiledGraph } from '../../shared/models/compiled-graph.js'
import { initRun } from '../engine/execution-engine.js'
import { generateInstanceId } from '../../shared/utils/id.js'
import { setCurrentRunId, resolveCurrentRunId } from './run-resolver.js'

export type { RunInfo, RunStatus }
export {
  getCurrentRunId,
  setCurrentRunId,
  resolveCurrentRunId,
  resolveActiveRunId,
  listRunIds,
} from './run-resolver.js'

// ===== Dependency Injection =====

export interface RunDeps {
  getRunDir?: (runId: string) => string
  getRunMetaFile?: (runId: string) => string
  getRunsDir?: () => string
  ensureDir?: (dirPath: string) => Promise<void>
  readJSON?: <T>(filePath: string) => Promise<T>
  writeJSON?: <T>(filePath: string, data: T) => Promise<void>
  fileExists?: (filePath: string) => Promise<boolean>
  readdir?: (dirPath: string) => Promise<string[]>
  generateInstanceId?: typeof generateInstanceId
  setCurrentRunId?: typeof setCurrentRunId
  resolveCurrentRunId?: typeof resolveCurrentRunId
}

let _defaults: Partial<RunDeps> = {}

/** Set default deps — called by engine/composition root at startup */
export function setDefaultRunDeps(defaults: Partial<RunDeps>): void {
  _defaults = { ..._defaults, ...defaults }
}

function resolveRunDeps(deps?: RunDeps) {
  const merged = { ..._defaults, ...deps }
  return {
    getRunDir: merged.getRunDir!,
    getRunMetaFile: merged.getRunMetaFile!,
    getRunsDir: merged.getRunsDir!,
    ensureDir: merged.ensureDir!,
    readJSON: merged.readJSON!,
    writeJSON: merged.writeJSON!,
    fileExists: merged.fileExists!,
    readdir: merged.readdir ?? ((dir: string) => fs.readdir(dir)),
    generateInstanceId: merged.generateInstanceId ?? generateInstanceId,
    setCurrentRunId: merged.setCurrentRunId ?? setCurrentRunId,
    resolveCurrentRunId: merged.resolveCurrentRunId ?? resolveCurrentRunId,
  }
}

export async function createRun(
  _label?: string,
  _graphName?: string,
  switchTo?: boolean,
  explicitRunId?: string,
  compiledGraph?: CompiledGraph,
  deps?: RunDeps,
): Promise<RunInfo> {
  const d = resolveRunDeps(deps)

  if (!compiledGraph) {
    throw new Error('compiledGraph is required to create a run')
  }

  let runId: string

  if (explicitRunId) {
    runId = explicitRunId
  } else {
    runId = d.generateInstanceId(compiledGraph.name)
  }

  const runInfo = await initRun(runId, compiledGraph)

  if (switchTo) {
    await d.setCurrentRunId(runId)
  }

  return runInfo
}

export async function listRuns(deps?: RunDeps): Promise<RunInfo[]> {
  const d = resolveRunDeps(deps)
  const runs: RunInfo[] = []
  const abs = path.resolve(d.getRunsDir())

  try {
    const entries = await d.readdir(abs)
    for (const entry of entries) {
      try {
        const metaFile = d.getRunMetaFile(entry)
        if (await d.fileExists(metaFile)) {
          const info = await d.readJSON<RunInfo>(metaFile)
          runs.push(info)
        }
      } catch {
        // skip invalid runs
      }
    }
  } catch {
    // runs dir doesn't exist
  }

  return runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function switchRun(runId: string, deps?: RunDeps): Promise<void> {
  const d = resolveRunDeps(deps)
  if (!(await d.fileExists(d.getRunMetaFile(runId)))) {
    throw new RunNotFoundError(runId)
  }
  await d.setCurrentRunId(runId)
}

export async function getGraphForRun(runId: string, deps?: RunDeps): Promise<string | null> {
  const d = resolveRunDeps(deps)
  const meta = await d.readJSON<RunInfo>(d.getRunMetaFile(runId))
  return meta.graphName ?? null
}

export async function resolveRunId(runId?: string, deps?: RunDeps): Promise<string> {
  if (runId) return runId
  const d = resolveRunDeps(deps)
  return d.resolveCurrentRunId()
}

export async function runExists(runId: string, deps?: RunDeps): Promise<boolean> {
  const { getRunMetaFile, fileExists } = resolveRunDeps(deps)
  const metaFile = getRunMetaFile(runId)
  return fileExists(metaFile)
}

export async function showRun(
  runId: string,
  deps?: RunDeps,
): Promise<RunInfo & { taskCount: number; completedTasks: number }> {
  const d = resolveRunDeps(deps)
  const metaFile = d.getRunMetaFile(runId)
  if (!(await d.fileExists(metaFile))) {
    throw new RunNotFoundError(runId)
  }

  const info = await d.readJSON<RunInfo>(metaFile)

  // For now, return basic info without task counts from workflow engine.
  // Task counts can be read from the TaskStore if needed.
  return { ...info, taskCount: 0, completedTasks: 0 }
}
