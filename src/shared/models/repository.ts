import type { RunInfo } from './compiled-graph.js'

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
