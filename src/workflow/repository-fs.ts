import { promises as fs } from 'fs'
import * as path from 'path'
import type { WorkflowRepository } from '../shared/models/repository.js'
import type { WorkflowRecord } from '../shared/models/superstep.js'
import { getWorkflowJsonlFile } from '../constants.js'
import { ensureDir } from '../utils/file.js'

/**
 * Filesystem-based implementation of WorkflowRepository.
 * Reads and writes workflow.jsonl files in the .dagman/runs/<runId>/ directory.
 */
export class FsWorkflowRepository implements WorkflowRepository {
  async readRecords(runId: string): Promise<WorkflowRecord[]> {
    const filePath = getWorkflowJsonlFile(runId)
    try {
      const content = await fs.readFile(path.resolve(filePath), 'utf-8')
      return content
        .trim()
        .split('\n')
        .filter((line: string) => line.length > 0)
        .map((line: string) => JSON.parse(line) as WorkflowRecord)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw err
    }
  }

  async appendRecord(runId: string, record: WorkflowRecord): Promise<void> {
    const filePath = getWorkflowJsonlFile(runId)
    await ensureDir(path.dirname(path.resolve(filePath)))
    const line = JSON.stringify(record) + '\n'
    await fs.appendFile(path.resolve(filePath), line, 'utf-8')
  }

  async rewriteRecords(runId: string, records: WorkflowRecord[]): Promise<void> {
    const filePath = getWorkflowJsonlFile(runId)
    const content = records.map((r) => JSON.stringify(r)).join('\n') + '\n'
    await fs.writeFile(path.resolve(filePath), content, 'utf-8')
  }
}
