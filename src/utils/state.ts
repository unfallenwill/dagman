import type { Channel } from '../models/channel.js'
import { isStateChannel, STATE_CHANNEL_PREFIX } from '../models/channel.js'

/**
 * Build a GraphState object from the current channels.
 * Extracts all _state.* channel values into a plain object.
 */
export function buildGraphState(channels: Record<string, Channel>): Record<string, any> {
  const state: Record<string, any> = {}
  for (const [name, ch] of Object.entries(channels)) {
    if (isStateChannel(name)) {
      const key = name.slice(STATE_CHANNEL_PREFIX.length + 1)
      state[key] = ch.value
    }
  }
  return state
}
