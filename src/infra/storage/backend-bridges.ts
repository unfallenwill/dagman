/**
 * Bridge adapters that implement the existing store interfaces
 * by delegating to a unified StorageBackend.
 *
 * Each bridge is a thin wrapper — every method is a one-liner delegation.
 * This allows domain code to keep using StateStore/ChannelStore/TaskStore/RunStore
 * while the backend provides the actual persistence.
 */

import type { StorageBackend } from '../../shared/models/storage-backend.js'
import type {
  Channel,
  RunInfo,
  State,
  StateSchema,
  Task,
  TaskStatus,
} from '../../shared/models/compiled-graph.js'
import type {
  ChannelStore,
  RunStore,
  StateStore,
  TaskStore,
} from '../../shared/models/store-repository.js'

// ─── State Store Bridge ──────────────────────────────────────────────

export class BackendStateStore implements StateStore {
  constructor(private readonly backend: StorageBackend) {}

  async init(runId: string, schema: StateSchema): Promise<void> {
    return this.backend.initState(runId, schema)
  }

  async read(runId: string): Promise<State> {
    return this.backend.readState(runId)
  }

  async patch(runId: string, patch: Record<string, unknown>): Promise<void> {
    return this.backend.patchState(runId, patch)
  }

  async reset(runId: string): Promise<void> {
    return this.backend.resetState(runId)
  }
}

// ─── Channel Store Bridge ────────────────────────────────────────────

export class BackendChannelStore implements ChannelStore {
  constructor(private readonly backend: StorageBackend) {}

  async init(
    runId: string,
    channels: Record<string, { type: 'trigger' | 'barrier'; writers?: string[] }>,
  ): Promise<void> {
    return this.backend.initChannels(runId, channels)
  }

  async readAll(runId: string): Promise<Record<string, Channel>> {
    return this.backend.readAllChannels(runId)
  }

  async read(runId: string, name: string): Promise<Channel | null> {
    return this.backend.readChannel(runId, name)
  }

  async trigger(runId: string, name: string): Promise<void> {
    return this.backend.triggerChannel(runId, name)
  }

  async barrierWrite(runId: string, name: string, writerId: string): Promise<boolean> {
    return this.backend.barrierWrite(runId, name, writerId)
  }

  async getVersion(runId: string, name: string): Promise<number> {
    return this.backend.getChannelVersion(runId, name)
  }
}

// ─── Task Store Bridge ───────────────────────────────────────────────

export class BackendTaskStore implements TaskStore {
  constructor(private readonly backend: StorageBackend) {}

  async create(runId: string, tasks: Task[]): Promise<void> {
    return this.backend.createTasks(runId, tasks)
  }

  async readAll(runId: string): Promise<Task[]> {
    return this.backend.readAllTasks(runId)
  }

  async readByStep(runId: string, step: number): Promise<Task[]> {
    return this.backend.readTasksByStep(runId, step)
  }

  async updateStatus(
    runId: string,
    nodeId: string,
    step: number,
    status: TaskStatus,
    error?: string,
  ): Promise<void> {
    return this.backend.updateTaskStatus(runId, nodeId, step, status, error)
  }

  async clear(runId: string): Promise<void> {
    return this.backend.clearTasks(runId)
  }
}

// ─── Run Store Bridge ────────────────────────────────────────────────

export class BackendRunStore implements RunStore {
  constructor(private readonly backend: StorageBackend) {}

  async create(info: RunInfo): Promise<void> {
    return this.backend.createRunInfo(info)
  }

  async read(runId: string): Promise<RunInfo> {
    return this.backend.readRunInfo(runId)
  }

  async update(runId: string, info: Partial<RunInfo>): Promise<void> {
    return this.backend.updateRunInfo(runId, info)
  }

  async listIds(): Promise<string[]> {
    return this.backend.listRunIds()
  }

  async readCurrentId(): Promise<string | null> {
    return this.backend.readCurrentRunId()
  }

  async writeCurrentId(runId: string): Promise<void> {
    return this.backend.writeCurrentRunId(runId)
  }

  async exists(runId: string): Promise<boolean> {
    return this.backend.hasRun(runId)
  }
}
