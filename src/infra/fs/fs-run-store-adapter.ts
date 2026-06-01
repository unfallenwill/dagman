import type { RunStore } from '../../shared/models/store-repository.js'
import type { RunInfo } from '../../shared/models/compiled-graph.js'
import type { RunRepository } from '../../shared/models/repository.js'

/**
 * Adapter that wraps an existing RunRepository to implement the new RunStore interface.
 *
 * Method mapping:
 * - create(info)       → repo.writeRunInfo(info.id, info)
 * - read(runId)        → repo.readRunInfo(runId)
 * - update(runId, ptr) → read + merge + write
 * - listIds()          → repo.listRunIds()
 * - readCurrentId()    → repo.readCurrentRunId()
 * - writeCurrentId()   → repo.writeCurrentRunId()
 * - exists(runId)      → try readRunInfo
 */
export class FsRunStoreAdapter implements RunStore {
  constructor(private readonly repo: RunRepository) {}

  async create(info: RunInfo): Promise<void> {
    await this.repo.writeRunInfo(info.id, info)
  }

  async read(runId: string): Promise<RunInfo> {
    const info = await this.repo.readRunInfo(runId)
    // Backward compat: old run.json files lack currentStepScheduled
    const scheduled = (info as unknown as Record<string, unknown>).currentStepScheduled
    return {
      ...info,
      currentStepScheduled: typeof scheduled === 'boolean' ? scheduled : false,
    }
  }

  async update(runId: string, partial: Partial<RunInfo>): Promise<void> {
    const current = await this.repo.readRunInfo(runId)
    const merged = { ...current, ...partial } as RunInfo
    await this.repo.writeRunInfo(runId, merged)
  }

  async listIds(): Promise<string[]> {
    return this.repo.listRunIds()
  }

  async readCurrentId(): Promise<string | null> {
    return this.repo.readCurrentRunId()
  }

  async writeCurrentId(runId: string): Promise<void> {
    return this.repo.writeCurrentRunId(runId)
  }

  async exists(runId: string): Promise<boolean> {
    try {
      await this.repo.readRunInfo(runId)
      return true
    } catch {
      return false
    }
  }
}
