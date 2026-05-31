import type { TaskStore } from '../../shared/models/store-repository.js'
import type { Task, TaskStatus } from '../../shared/models/compiled-graph.js'
import { getTasksFile } from './paths.js'
import { readJSON, writeJSON, fileExists } from './file-ops.js'
import { systemClock } from '../../shared/utils/clock.js'

/**
 * Filesystem-based implementation of TaskStore.
 * Manages tasks.json — task execution statuses.
 */
export class FsTaskRepository implements TaskStore {
  async create(runId: string, tasks: Task[]): Promise<void> {
    const existing = await this.readAll(runId)
    existing.push(...tasks)
    await writeJSON(getTasksFile(runId), existing)
  }

  async readAll(runId: string): Promise<Task[]> {
    const filePath = getTasksFile(runId)
    if (!(await fileExists(filePath))) {
      return []
    }
    return readJSON<Task[]>(filePath)
  }

  async readByStep(runId: string, step: number): Promise<Task[]> {
    const all = await this.readAll(runId)
    return all.filter((t) => t.step === step)
  }

  async updateStatus(
    runId: string,
    nodeId: string,
    step: number,
    status: TaskStatus,
    error?: string,
  ): Promise<void> {
    const all = await this.readAll(runId)
    const task = all.find((t) => t.nodeId === nodeId && t.step === step)
    if (!task) {
      throw new Error(`task '${nodeId}@step${step}' not found`)
    }
    task.status = status
    if (status === 'running') {
      task.startedAt = systemClock()
    }
    if (status === 'success' || status === 'failed') {
      task.completedAt = systemClock()
    }
    if (error !== undefined) {
      task.error = error
    }
    await writeJSON(getTasksFile(runId), all)
  }

  async clear(runId: string): Promise<void> {
    await writeJSON(getTasksFile(runId), [])
  }
}
