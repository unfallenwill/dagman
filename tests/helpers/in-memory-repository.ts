import type {
  WorkflowRepository,
  EventRepository,
  RunRepository,
} from '../../src/shared/models/repository.js'
import type { WorkflowRecord, RunInfo } from '../../src/shared/models/superstep.js'
import type { Event } from '../../src/shared/models/event.js'
import { fixedClock } from '../../src/shared/utils/clock.js'
import type { WorkflowDeps } from '../../src/domain/workflow/workflow-engine.js'

export class InMemoryWorkflowRepository implements WorkflowRepository {
  private store = new Map<string, WorkflowRecord[]>()

  async readRecords(runId: string): Promise<WorkflowRecord[]> {
    return this.store.get(runId) ?? []
  }

  async appendRecord(runId: string, record: WorkflowRecord): Promise<void> {
    const records = this.store.get(runId) ?? []
    records.push(record)
    this.store.set(runId, records)
  }

  async rewriteRecords(runId: string, records: WorkflowRecord[]): Promise<void> {
    this.store.set(runId, records)
  }
}

export class InMemoryEventRepository implements EventRepository {
  private store = new Map<string, Event[]>()

  async appendEvent(runId: string, event: Event): Promise<void> {
    const events = this.store.get(runId) ?? []
    events.push(event)
    this.store.set(runId, events)
  }

  async readEvents(runId: string): Promise<Event[]> {
    return this.store.get(runId) ?? []
  }
}

export class InMemoryRunRepository implements RunRepository {
  private runs = new Map<string, RunInfo>()
  private currentRunId: string | null = null

  async readRunInfo(runId: string): Promise<RunInfo> {
    const info = this.runs.get(runId)
    if (!info) throw new Error(`run '${runId}' not found`)
    return info
  }

  async writeRunInfo(runId: string, info: RunInfo): Promise<void> {
    this.runs.set(runId, info)
  }

  async listRunIds(): Promise<string[]> {
    return Array.from(this.runs.keys())
  }

  async readCurrentRunId(): Promise<string | null> {
    return this.currentRunId
  }

  async writeCurrentRunId(runId: string): Promise<void> {
    this.currentRunId = runId
  }
}

export function createTestWorkflowDeps(timestamp = '2025-01-01T00:00:00.000Z'): WorkflowDeps & {
  repo: InMemoryWorkflowRepository
  eventRepo: InMemoryEventRepository
  runRepo: InMemoryRunRepository
} {
  const repo = new InMemoryWorkflowRepository()
  const eventRepo = new InMemoryEventRepository()
  const runRepo = new InMemoryRunRepository()
  return {
    clock: fixedClock(timestamp),
    repo,
    eventRepo,
    runRepo,
  }
}
