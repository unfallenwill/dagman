/**
 * State service — thin convenience wrapper around StorageBackend.
 *
 * Provides simple read/patch/get-key operations on the shared run state.
 * Uses DI pattern like other domain services.
 */

import type { StorageBackend } from '../../shared/models/storage-backend.js'
import type { State, StatePatch } from '../../shared/models/compiled-graph.js'

// ── DI Pattern ──────────────────────────────────────────────────────

export interface StateServiceDeps {
  storageBackend?: StorageBackend
}

let _defaults: Partial<StateServiceDeps> = {}

/** Set default deps — called by engine/composition root at startup */
export function setDefaultStateServiceDeps(defaults: Partial<StateServiceDeps>): void {
  _defaults = { ..._defaults, ...defaults }
}

function resolveStateServiceDeps(deps?: StateServiceDeps) {
  const merged = { ..._defaults, ...deps }
  return {
    backend: merged.storageBackend!,
  }
}

// ── API ─────────────────────────────────────────────────────────────

/** Read the full shared state for a run */
export async function readState(runId: string, deps?: StateServiceDeps): Promise<State> {
  const d = resolveStateServiceDeps(deps)
  return d.backend.readState(runId)
}

/** Apply a partial state update (merge into current state) */
export async function patchState(
  runId: string,
  patch: StatePatch,
  deps?: StateServiceDeps,
): Promise<void> {
  const d = resolveStateServiceDeps(deps)
  await d.backend.patchState(runId, patch)
}

/** Read a single key from the shared state */
export async function getStateKey(
  runId: string,
  key: string,
  deps?: StateServiceDeps,
): Promise<unknown> {
  const state = await readState(runId, deps)
  return state[key]
}
