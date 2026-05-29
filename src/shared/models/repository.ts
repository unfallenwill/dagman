import type { WorkflowRecord, RunInfo } from './superstep.js'
import type { Event } from './event.js'

/**
 * Abstraction over JSONL workflow state persistence.
 * Enables testing workflow logic without a real filesystem.
 */
export interface WorkflowRepository {
  readRecords(runId: string): Promise<WorkflowRecord[]>
  appendRecord(runId: string, record: WorkflowRecord): Promise<void>
  rewriteRecords(runId: string, records: WorkflowRecord[]): Promise<void>
}

/**
 * Abstraction over the append-only event log.
 */
export interface EventRepository {
  appendEvent(runId: string, event: Event): Promise<void>
  readEvents(runId: string): Promise<Event[]>
}

/**
 * Abstraction over run metadata and current-run pointer persistence.
 */
export interface RunRepository {
  readRunInfo(runId: string): Promise<RunInfo>
  writeRunInfo(runId: string, info: RunInfo): Promise<void>
  listRunIds(): Promise<string[]>
  readCurrentRunId(): Promise<string | null>
  writeCurrentRunId(runId: string): Promise<void>
}
