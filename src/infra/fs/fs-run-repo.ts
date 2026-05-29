import { promises as fs } from 'fs'
import * as path from 'path'
import type { RunRepository } from '../../shared/models/repository.js'
import type { RunInfo } from '../../shared/models/superstep.js'
import { getRunMetaFile, getRunsDir, getCurrentRunFilePath, getDagmanDir } from './paths.js'
import { ensureDir, readJSON, writeJSON, fileExists } from './file-ops.js'

/**
 * Filesystem-based implementation of RunRepository.
 * Manages run.json files and the .current-run pointer file.
 */
export class FsRunRepository implements RunRepository {
  async readRunInfo(runId: string): Promise<RunInfo> {
    return readJSON<RunInfo>(getRunMetaFile(runId))
  }

  async writeRunInfo(runId: string, info: RunInfo): Promise<void> {
    await writeJSON(getRunMetaFile(runId), info)
  }

  async listRunIds(): Promise<string[]> {
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

  async readCurrentRunId(): Promise<string | null> {
    const filePath = getCurrentRunFilePath()
    if (!(await fileExists(filePath))) {
      return null
    }
    const content = await fs.readFile(path.resolve(filePath), 'utf-8')
    return content.trim() || null
  }

  async writeCurrentRunId(runId: string): Promise<void> {
    await ensureDir(getDagmanDir())
    await fs.writeFile(path.resolve(getCurrentRunFilePath()), runId, 'utf-8')
  }
}
