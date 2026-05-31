/**
 * Repository interfaces for the new direct-state storage model.
 *
 * Three separate stores:
 * - StateStore: state.json (shared mutable state)
 * - ChannelStore: channels.json (trigger + barrier channels)
 * - TaskStore: tasks.json (task execution status)
 * - RunStore: run metadata + current pointer
 */

import type { State, StateSchema } from './compiled-graph.js'
import type { Channel, Task, RunInfo } from './compiled-graph.js'

// ─── State Store ─────────────────────────────────────────────────────

export interface StateStore {
  /** Initialize state from schema (all keys → initial values) */
  init(runId: string, schema: StateSchema): Promise<void>

  /** Read the full state */
  read(runId: string): Promise<State>

  /** Apply a patch (merge into state) */
  patch(runId: string, patch: Record<string, unknown>): Promise<void>

  /** Clear all state back to schema defaults */
  reset(runId: string): Promise<void>
}

// ─── Channel Store ───────────────────────────────────────────────────

export interface ChannelStore {
  /** Initialize channels from compiled graph channel definitions */
  init(
    runId: string,
    channels: Record<string, { type: 'trigger' | 'barrier'; writers?: string[] }>,
  ): Promise<void>

  /** Read all channels */
  readAll(runId: string): Promise<Record<string, Channel>>

  /** Read a single channel */
  read(runId: string, name: string): Promise<Channel | null>

  /** Write to a trigger channel (increment version) */
  trigger(runId: string, name: string): Promise<void>

  /** Write to a barrier channel (record writer, trigger if all writers done) */
  barrierWrite(runId: string, name: string, writerId: string): Promise<boolean>

  /** Get the version of a channel */
  getVersion(runId: string, name: string): Promise<number>
}

// ─── Task Store ──────────────────────────────────────────────────────

export interface TaskStore {
  /** Create tasks for a step */
  create(runId: string, tasks: Task[]): Promise<void>

  /** Read all tasks */
  readAll(runId: string): Promise<Task[]>

  /** Read tasks for a specific step */
  readByStep(runId: string, step: number): Promise<Task[]>

  /** Update a single task's status */
  updateStatus(
    runId: string,
    nodeId: string,
    step: number,
    status: Task['status'],
    error?: string,
  ): Promise<void>

  /** Clear all tasks */
  clear(runId: string): Promise<void>
}

// ─── Run Store ───────────────────────────────────────────────────────

export interface RunStore {
  /** Create a new run */
  create(info: RunInfo): Promise<void>

  /** Read run info */
  read(runId: string): Promise<RunInfo>

  /** Update run info */
  update(runId: string, info: Partial<RunInfo>): Promise<void>

  /** List all run IDs */
  listIds(): Promise<string[]>

  /** Read the current run ID */
  readCurrentId(): Promise<string | null>

  /** Set the current run ID */
  writeCurrentId(runId: string): Promise<void>

  /** Check if run exists */
  exists(runId: string): Promise<boolean>
}
