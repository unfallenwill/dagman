import { describe, it, expect } from 'vitest'
import { buildGraphState } from '../../../src/shared/utils/state.js'
import type { Channel } from '../../../src/shared/models/channel.js'

function makeChannel(value: unknown, version = 1): Channel {
  return {
    name: '',
    value,
    version,
    updatedAt: '2025-01-01T00:00:00Z',
  }
}

describe('buildGraphState', () => {
  it('should return empty object for empty channels', () => {
    const result = buildGraphState({})
    expect(result).toEqual({})
  })

  it('should extract _state.* channels into state object', () => {
    const channels: Record<string, Channel> = {
      '_state.counter': makeChannel(42),
      '_state.name': makeChannel('dagman'),
    }
    const result = buildGraphState(channels)
    expect(result).toEqual({ counter: 42, name: 'dagman' })
  })

  it('should ignore non-state channels', () => {
    const channels: Record<string, Channel> = {
      'node.output': makeChannel('result'),
      'edge:A→B': makeChannel('success'),
      '_global.env': makeChannel('production'),
    }
    const result = buildGraphState(channels)
    expect(result).toEqual({})
  })

  it('should handle mix of state and non-state channels', () => {
    const channels: Record<string, Channel> = {
      '_state.counter': makeChannel(10),
      'node.build.output': makeChannel('/dist'),
      '_state.initialized': makeChannel(true),
      'edge:build→deploy': makeChannel('success'),
    }
    const result = buildGraphState(channels)
    expect(result).toEqual({ counter: 10, initialized: true })
  })

  it('should handle complex state values', () => {
    const channels: Record<string, Channel> = {
      '_state.config': makeChannel({ retries: 3, timeout: 5000 }),
    }
    const result = buildGraphState(channels)
    expect(result.config).toEqual({ retries: 3, timeout: 5000 })
  })

  it('should handle null state values', () => {
    const channels: Record<string, Channel> = {
      '_state.result': makeChannel(null),
    }
    const result = buildGraphState(channels)
    expect(result).toEqual({ result: null })
  })
})
