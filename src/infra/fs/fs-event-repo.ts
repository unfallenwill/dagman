import { promises as fs } from 'fs'
import * as path from 'path'
import type { EventRepository } from '../../shared/models/repository.js'
import type { Event } from '../../shared/models/event.js'
import { getEventsFile } from './paths.js'
import { ensureDir } from './file-ops.js'

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
