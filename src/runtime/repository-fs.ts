import { promises as fs } from 'fs'
import * as path from 'path'
import type { EventRepository, RunRepository } from '../shared/models/repository.js'
import type { Event } from '../shared/models/event.js'
import type { RunInfo } from '../shared/models/superstep.js'
import {
  getEventsFile,
  getRunMetaFile,
  getRunsDir,
  getCurrentRunFilePath,
  getDagmanDir,
} from '../constants.js'
import { ensureDir, readJSON, writeJSON, fileExists } from '../utils/file.js'

/**
 * Filesystem-based implementation of EventRepository.
 * Reads and writes events.jsonl files in the .dagman/runs/<runId>/ directory.
 */
export class FsEventRepository implements EventRepository {
  async appendEvent(runId: string, event: Event): Promise<void> {
    const filePath = getEventsFile(runId)
    await ensureDir(path.dirname(path.resolve(filePath)))
    const line = JSON.stringify(event) + '\n'
    await fs.appendFile(path.resolve(filePath), line, 'utf-8')
  }

  async readEvents(runId: string): Promise<Event[]> {
    const filePath = getEventsFile(runId)
    try {
      const content = await fs.readFile(path.resolve(filePath), 'utf-8')
      return content
        .trim()
        .split('\n')
        .filter((line: string) => line.length > 0)
        .map((line: string) => JSON.parse(line) as Event)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw err
    }
  }
}

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
