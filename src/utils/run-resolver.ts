import { promises as fs } from 'fs'
import * as path from 'path'
import {
  DEFAULT_RUN_ID,
  getRunMetaFile,
  getCurrentRunFilePath,
  getRunsDir,
  getDagmanDir,
} from '../constants.js'
import { ensureDir, fileExists } from './file.js'
import { readJSON } from './file.js'
import type { RunStatus } from '../models/superstep.js'

export async function getCurrentRunId(): Promise<string | null> {
  const filePath = getCurrentRunFilePath()
  if (!(await fileExists(filePath))) {
    return null
  }
  const content = await fs.readFile(path.resolve(filePath), 'utf-8')
  return content.trim() || null
}

export async function setCurrentRunId(runId: string): Promise<void> {
  await ensureDir(getDagmanDir())
  await fs.writeFile(path.resolve(getCurrentRunFilePath()), runId, 'utf-8')
}

export async function resolveCurrentRunId(): Promise<string> {
  const current = await getCurrentRunId()
  if (current) return current
  return DEFAULT_RUN_ID
}

export async function listRunIds(): Promise<string[]> {
  const abs = path.resolve(getRunsDir())
  try {
    const entries = await fs.readdir(abs)
    const ids: string[] = []
    for (const entry of entries) {
      if (await fileExists(getRunMetaFile(entry))) {
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
export async function resolveActiveRunId(): Promise<string> {
  // First try .current-run file
  const current = await getCurrentRunId()
  if (current) {
    return current
  }

  // Scan for running runs
  const runIds = await listRunIds()
  const runningRuns: string[] = []

  for (const runId of runIds) {
    try {
      const meta = await readJSON<{ status?: RunStatus }>(getRunMetaFile(runId))
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
