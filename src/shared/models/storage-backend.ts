/**
 * Unified storage backend abstraction.
 *
 * All data is scoped per-run. The backend manages its own serialization
 * and persistence strategy. Implementations must ensure:
 * - Per-run data isolation (no cross-run leakage)
 * - Idempotent init (calling init twice is safe)
 *
 * The backend consolidates all persistence concerns into one contract.
 * Adding a new backend (e.g. SQLite) means implementing this interface
 * without changing any domain code.
 */

import type { Channel, RunInfo, State, StateSchema, Task, TaskStatus } from './compiled-graph.js'

// ─── Storage Backend ─────────────────────────────────────────────────

export interface StorageBackend {
  // ── State (key-value) ────────────────────────────────────────────

  /** Initialize state from schema. Overwrites if exists. */
  initState(runId: string, schema: StateSchema): Promise<void>

  /** Read full state. Returns {} if not initialized. */
  readState(runId: string): Promise<State>

  /** Merge patch into current state. */
  patchState(runId: string, patch: Record<string, unknown>): Promise<void>

  /** Reset state to empty. */
  resetState(runId: string): Promise<void>

  // ── Channels (keyed map) ─────────────────────────────────────────

  /** Initialize channels from definitions. Overwrites if exists. */
  initChannels(
    runId: string,
    channels: Record<string, { type: 'trigger' | 'barrier'; writers?: string[] }>,
  ): Promise<void>

  /** Read all channels. Returns {} if not initialized. */
  readAllChannels(runId: string): Promise<Record<string, Channel>>

  /** Read a single channel. Returns null if not found. */
  readChannel(runId: string, name: string): Promise<Channel | null>

  /** Trigger a channel (increment version). Throws if not trigger type. */
  triggerChannel(runId: string, name: string): Promise<void>

  /** Write to a barrier channel. Returns true if barrier is now complete. */
  barrierWrite(runId: string, name: string, writerId: string): Promise<boolean>

  /** Get channel version. Throws if not found. */
  getChannelVersion(runId: string, name: string): Promise<number>

  // ── Tasks (append-only collection) ───────────────────────────────

  /** Create tasks (append). */
  createTasks(runId: string, tasks: Task[]): Promise<void>

  /** Read all tasks. Returns [] if none. */
  readAllTasks(runId: string): Promise<Task[]>

  /** Read tasks for a specific step. */
  readTasksByStep(runId: string, step: number): Promise<Task[]>

  /** Update a single task's status. */
  updateTaskStatus(
    runId: string,
    nodeId: string,
    step: number,
    status: TaskStatus,
    error?: string,
  ): Promise<void>

  /** Clear all tasks. */
  clearTasks(runId: string): Promise<void>

  // ── Run Info (single record per run) ─────────────────────────────

  /** Create run metadata. */
  createRunInfo(info: RunInfo): Promise<void>

  /** Read run metadata. Throws if not found. */
  readRunInfo(runId: string): Promise<RunInfo>

  /** Update run metadata (partial merge). */
  updateRunInfo(runId: string, patch: Partial<RunInfo>): Promise<void>

  // ── Run Registry (cross-run operations) ──────────────────────────

  /** List all run IDs. */
  listRunIds(): Promise<string[]>

  /** Read the current run pointer. */
  readCurrentRunId(): Promise<string | null>

  /** Write the current run pointer. */
  writeCurrentRunId(runId: string): Promise<void>

  /** Check if a run exists in storage. */
  hasRun(runId: string): Promise<boolean>

  // ── Graph Reference (structural data, no functions) ──────────────

  /** Write graph reference data for a run. */
  writeGraphRef(runId: string, data: unknown): Promise<void>

  /** Read graph reference data for a run. */
  readGraphRef<T>(runId: string): Promise<T>
}
