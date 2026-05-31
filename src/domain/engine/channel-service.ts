/**
 * Channel service — thin convenience wrapper around ChannelStore.
 *
 * Provides simple trigger/barrier-write/read operations
 * on channel state. Uses DI pattern like other domain services.
 */

import type { ChannelStore } from '../../shared/models/store-repository.js'
import type { Channel } from '../../shared/models/compiled-graph.js'

// ── DI Pattern ──────────────────────────────────────────────────────

export interface ChannelServiceDeps {
  channelStore?: ChannelStore
}

let _defaults: Partial<ChannelServiceDeps> = {}

/** Set default deps — called by engine/composition root at startup */
export function setDefaultChannelServiceDeps(defaults: Partial<ChannelServiceDeps>): void {
  _defaults = { ..._defaults, ...defaults }
}

function resolveChannelServiceDeps(deps?: ChannelServiceDeps) {
  const merged = { ..._defaults, ...deps }
  return {
    channelStore: merged.channelStore!,
  }
}

// ── API ─────────────────────────────────────────────────────────────

/** Trigger a channel (increment version for trigger channels) */
export async function triggerChannel(
  runId: string,
  name: string,
  deps?: ChannelServiceDeps,
): Promise<void> {
  const d = resolveChannelServiceDeps(deps)
  await d.channelStore.trigger(runId, name)
}

/** Write to a barrier channel as a specific writer */
export async function barrierWrite(
  runId: string,
  name: string,
  writerId: string,
  deps?: ChannelServiceDeps,
): Promise<boolean> {
  const d = resolveChannelServiceDeps(deps)
  return d.channelStore.barrierWrite(runId, name, writerId)
}

/** Read a single channel by name */
export async function readChannel(
  runId: string,
  name: string,
  deps?: ChannelServiceDeps,
): Promise<Channel | null> {
  const d = resolveChannelServiceDeps(deps)
  return d.channelStore.read(runId, name)
}
