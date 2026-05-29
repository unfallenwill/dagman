import { describe, it, expect } from 'vitest'
import { aggregateChannels, computeEdgeChannelUpdates } from '../../src/workflow/channel-ops.js'
import type { WorkflowRecord } from '../../src/shared/models/superstep.js'
import type { Edge } from '../../src/shared/models/graph.js'
import type { Channel } from '../../src/shared/models/channel.js'

function makeChannel(name: string, value: unknown, version: number): Channel {
  return { name, value, version, updatedAt: '2025-01-01T00:00:00.000Z' }
}

function makeRecord(
  step: number,
  channelChanges: Record<string, Channel>,
  overrides?: Partial<WorkflowRecord>,
): WorkflowRecord {
  return {
    step,
    status: 'running',
    tasks: [],
    channelChanges,
    ...overrides,
  }
}

describe('aggregateChannels', () => {
  it('returns empty map for empty records', () => {
    const result = aggregateChannels([])
    expect(result).toEqual({})
  })

  it('returns channels from a single record', () => {
    const ch = makeChannel('edge:a→b', 'success', 1)
    const record = makeRecord(0, { 'edge:a→b': ch })
    const result = aggregateChannels([record])
    expect(result['edge:a→b']).toEqual(ch)
  })

  it('later record overrides earlier for same key', () => {
    const ch1 = makeChannel('edge:a→b', null, 0)
    const ch2 = makeChannel('edge:a→b', 'success', 1)
    const r1 = makeRecord(0, { 'edge:a→b': ch1 })
    const r2 = makeRecord(1, { 'edge:a→b': ch2 })
    const result = aggregateChannels([r1, r2])
    expect(result['edge:a→b']).toEqual(ch2)
  })

  it('merges channels from different keys across records', () => {
    const chA = makeChannel('edge:a→b', 'success', 1)
    const chB = makeChannel('edge:b→c', 'success', 1)
    const r1 = makeRecord(0, { 'edge:a→b': chA })
    const r2 = makeRecord(1, { 'edge:b→c': chB })
    const result = aggregateChannels([r1, r2])
    expect(Object.keys(result)).toHaveLength(2)
    expect(result['edge:a→b']).toEqual(chA)
    expect(result['edge:b→c']).toEqual(chB)
  })
})

describe('computeEdgeChannelUpdates', () => {
  const TS = '2025-01-01T00:00:00.000Z'

  it('returns empty map when no edges match nodeId', () => {
    const edges: Edge[] = [{ from: 'b', to: 'a' }]
    const result = computeEdgeChannelUpdates('c', 'success', edges, {}, TS)
    expect(result).toEqual({})
  })

  it('creates edge channel for matching edge', () => {
    const edges: Edge[] = [{ from: 'b', to: 'a' }]
    const result = computeEdgeChannelUpdates('a', 'success', edges, {}, TS)
    expect(result['edge:a→b']).toEqual({
      name: 'edge:a→b',
      value: 'success',
      version: 1,
      updatedAt: TS,
    })
  })

  it('increments version from existing channel', () => {
    const edges: Edge[] = [{ from: 'b', to: 'a' }]
    const existing = { 'edge:a→b': makeChannel('edge:a→b', null, 3) }
    const result = computeEdgeChannelUpdates('a', 'success', edges, existing, TS)
    expect(result['edge:a→b']!.version).toBe(4)
  })

  it('creates channels for multiple matching edges', () => {
    const edges: Edge[] = [
      { from: 'b', to: 'a' },
      { from: 'c', to: 'a' },
    ]
    const result = computeEdgeChannelUpdates('a', 'skipped', edges, {}, TS)
    expect(Object.keys(result)).toHaveLength(2)
    expect(result['edge:a→b']!.value).toBe('skipped')
    expect(result['edge:a→c']!.value).toBe('skipped')
  })
})
