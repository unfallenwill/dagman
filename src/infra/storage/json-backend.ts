/**
 * JSON file-based implementation of StorageBackend.
 *
 * Persists all data as JSON files under .dagman/runs/<runId>/.
 * This is a direct port of the logic from:
 * - FsStateRepository  → state methods
 * - FsChannelRepository → channel methods
 * - FsTaskRepository    → task methods
 * - FsRunRepository + FsRunStoreAdapter → run methods
 *
 * Uses path helpers and JSON primitives injected via deps for testability.
 */

import { promises as fs } from 'fs'
import * as path from 'path'
import type { StorageBackend } from '../../shared/models/storage-backend.js'
import type {
  Channel,
  RunInfo,
  State,
  StateSchema,
  Task,
  TaskStatus,
} from '../../shared/models/compiled-graph.js'
import type { BackendDeps } from './backend-factory.js'

/** Internal shape stored in channels.json */
type ChannelMap = Record<string, Channel>

export class JsonStorageBackend implements StorageBackend {
  constructor(private readonly deps: BackendDeps) {}

  // ── State ──────────────────────────────────────────────────────────

  async initState(runId: string, schema: StateSchema): Promise<void> {
    const initial: State = { ...schema }
    await this.deps.writeJSON(this.deps.getStateFile(runId), initial)
  }

  async readState(runId: string): Promise<State> {
    const filePath = this.deps.getStateFile(runId)
    if (!(await this.deps.fileExists(filePath))) {
      return {}
    }
    return this.deps.readJSON<State>(filePath)
  }

  async patchState(runId: string, patch: Record<string, unknown>): Promise<void> {
    const current = await this.readState(runId)
    const updated = Object.assign({}, current, patch)
    await this.deps.writeJSON(this.deps.getStateFile(runId), updated)
  }

  async resetState(runId: string): Promise<void> {
    const filePath = this.deps.getStateFile(runId)
    if (!(await this.deps.fileExists(filePath))) {
      return
    }
    await this.deps.writeJSON(filePath, {})
  }

  // ── Channels ───────────────────────────────────────────────────────

  async initChannels(
    runId: string,
    channels: Record<string, { type: 'trigger' | 'barrier'; writers?: string[] }>,
  ): Promise<void> {
    const map: ChannelMap = {}
    for (const [name, def] of Object.entries(channels)) {
      if (def.type === 'trigger') {
        map[name] = { name, type: 'trigger', version: 0 }
      } else {
        map[name] = {
          name,
          type: 'barrier',
          writers: def.writers ?? [],
          received: [],
          version: 0,
        }
      }
    }
    await this.deps.writeJSON(this.deps.getChannelsFile(runId), map)
  }

  async readAllChannels(runId: string): Promise<Record<string, Channel>> {
    const filePath = this.deps.getChannelsFile(runId)
    if (!(await this.deps.fileExists(filePath))) {
      return {}
    }
    return this.deps.readJSON<ChannelMap>(filePath)
  }

  async readChannel(runId: string, name: string): Promise<Channel | null> {
    const all = await this.readAllChannels(runId)
    return all[name] ?? null
  }

  async triggerChannel(runId: string, name: string): Promise<void> {
    const all = await this.readAllChannels(runId)
    const ch = all[name]
    if (!ch?.type || ch.type !== 'trigger') {
      throw new Error(`trigger channel '${name}' not found`)
    }
    ch.version += 1
    await this.deps.writeJSON(this.deps.getChannelsFile(runId), all)
  }

  async barrierWrite(runId: string, name: string, writerId: string): Promise<boolean> {
    const all = await this.readAllChannels(runId)
    const ch = all[name]
    if (!ch?.type || ch.type !== 'barrier') {
      throw new Error(`barrier channel '${name}' not found`)
    }
    if (!ch.received.includes(writerId)) {
      ch.received.push(writerId)
    }
    const complete = ch.received.length === ch.writers.length
    if (complete && ch.version === 0) {
      ch.version = 1
    }
    await this.deps.writeJSON(this.deps.getChannelsFile(runId), all)
    return complete
  }

  async getChannelVersion(runId: string, name: string): Promise<number> {
    const ch = await this.readChannel(runId, name)
    if (!ch) {
      throw new Error(`channel '${name}' not found`)
    }
    return ch.version
  }

  // ── Tasks ───────────────────────────────────────────────────────────

  async createTasks(runId: string, tasks: Task[]): Promise<void> {
    const existing = await this.readAllTasks(runId)
    existing.push(...tasks)
    await this.deps.writeJSON(this.deps.getTasksFile(runId), existing)
  }

  async readAllTasks(runId: string): Promise<Task[]> {
    const filePath = this.deps.getTasksFile(runId)
    if (!(await this.deps.fileExists(filePath))) {
      return []
    }
    return this.deps.readJSON<Task[]>(filePath)
  }

  async readTasksByStep(runId: string, step: number): Promise<Task[]> {
    const all = await this.readAllTasks(runId)
    return all.filter((t) => t.step === step)
  }

  async updateTaskStatus(
    runId: string,
    nodeId: string,
    step: number,
    status: TaskStatus,
    error?: string,
  ): Promise<void> {
    const all = await this.readAllTasks(runId)
    const task = all.find((t) => t.nodeId === nodeId && t.step === step)
    if (!task) {
      throw new Error(`task '${nodeId}@step${step}' not found`)
    }
    task.status = status
    if (status === 'running') {
      task.startedAt = this.deps.clock()
    }
    if (status === 'success' || status === 'failed') {
      task.completedAt = this.deps.clock()
    }
    if (error !== undefined) {
      task.error = error
    }
    await this.deps.writeJSON(this.deps.getTasksFile(runId), all)
  }

  async clearTasks(runId: string): Promise<void> {
    await this.deps.writeJSON(this.deps.getTasksFile(runId), [])
  }

  // ── Run Info ────────────────────────────────────────────────────────

  async createRunInfo(info: RunInfo): Promise<void> {
    await this.deps.writeJSON(this.deps.getRunMetaFile(info.id), info)
  }

  async readRunInfo(runId: string): Promise<RunInfo> {
    const info = await this.deps.readJSON<RunInfo>(this.deps.getRunMetaFile(runId))
    // Backward compat: old run.json files lack currentStepScheduled
    const scheduled = (info as unknown as Record<string, unknown>).currentStepScheduled
    return {
      ...info,
      currentStepScheduled: typeof scheduled === 'boolean' ? scheduled : false,
    }
  }

  async updateRunInfo(runId: string, patch: Partial<RunInfo>): Promise<void> {
    const current = await this.readRunInfo(runId)
    const merged = { ...current, ...patch } as RunInfo
    await this.deps.writeJSON(this.deps.getRunMetaFile(runId), merged)
  }

  // ── Run Registry ────────────────────────────────────────────────────

  async listRunIds(): Promise<string[]> {
    const abs = path.resolve(this.deps.getRunsDir())
    try {
      const entries = await fs.readdir(abs)
      const ids: string[] = []
      for (const entry of entries) {
        if (await this.deps.fileExists(this.deps.getRunMetaFile(entry))) {
          ids.push(entry)
        }
      }
      return ids
    } catch {
      return []
    }
  }

  async readCurrentRunId(): Promise<string | null> {
    const filePath = this.deps.getCurrentRunFilePath()
    if (!(await this.deps.fileExists(filePath))) {
      return null
    }
    const content = await fs.readFile(path.resolve(filePath), 'utf-8')
    return content.trim() || null
  }

  async writeCurrentRunId(runId: string): Promise<void> {
    await this.deps.ensureDir(this.deps.getDagmanDir())
    await fs.writeFile(path.resolve(this.deps.getCurrentRunFilePath()), runId, 'utf-8')
  }

  async hasRun(runId: string): Promise<boolean> {
    try {
      await this.readRunInfo(runId)
      return true
    } catch {
      return false
    }
  }

  // ── Graph Reference ─────────────────────────────────────────────────

  async writeGraphRef(runId: string, data: unknown): Promise<void> {
    await this.deps.writeJSON(this.deps.getGraphFile(runId), data)
  }

  async readGraphRef<T>(runId: string): Promise<T> {
    return this.deps.readJSON<T>(this.deps.getGraphFile(runId))
  }
}
