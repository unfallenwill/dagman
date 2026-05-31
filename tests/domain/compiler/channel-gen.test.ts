import { describe, it, expect } from 'vitest'
import { generateChannels } from '../../../src/domain/compiler/channel-gen.js'
import type { PlainEdge, ConditionalEdge } from '../../../src/shared/models/compiled-graph.js'

const routeFn = (_s: Record<string, unknown>) => ['B']

describe('channel-gen', () => {
  describe('generateChannels', () => {
    it('should produce no channels for empty edges', () => {
      const result = generateChannels(['A', 'B'], [])
      expect(result.channels).toEqual({})
      expect(result.nodeStrategies).toEqual({ A: [], B: [] })
      expect(result.nodeTriggeredBy).toEqual({})
    })

    it('should generate trigger channel for single edge A→B', () => {
      const result = generateChannels(['A', 'B'], [{ from: 'A', to: 'B' }])

      expect(result.channels['trigger:B']).toEqual({
        name: 'trigger:B',
        type: 'trigger',
      })
      // A has DirectWrite to trigger:B
      expect(result.nodeStrategies['A']).toEqual([{ type: 'direct', channel: 'trigger:B' }])
      // B is triggeredBy trigger:B
      expect(result.nodeTriggeredBy['B']).toBe('trigger:B')
    })

    it('should generate barrier channel for join A→C, B→C', () => {
      const edges: PlainEdge[] = [
        { from: 'A', to: 'C' },
        { from: 'B', to: 'C' },
      ]
      const result = generateChannels(['A', 'B', 'C'], edges)

      expect(result.channels['barrier:C']).toEqual({
        name: 'barrier:C',
        type: 'barrier',
        writers: ['A', 'B'],
      })
      // Both sources have DirectWrite to barrier:C
      expect(result.nodeStrategies['A']).toEqual([{ type: 'direct', channel: 'barrier:C' }])
      expect(result.nodeStrategies['B']).toEqual([{ type: 'direct', channel: 'barrier:C' }])
      // C is triggeredBy barrier:C
      expect(result.nodeTriggeredBy['C']).toBe('barrier:C')
    })

    it('should handle conditional edge A→[B, C]', () => {
      const edges: ConditionalEdge[] = [{ from: 'A', targets: ['B', 'C'], fn: routeFn }]
      const result = generateChannels(['A', 'B', 'C'], edges)

      // trigger:B and trigger:C channels created
      expect(result.channels['trigger:B']).toEqual({
        name: 'trigger:B',
        type: 'trigger',
      })
      expect(result.channels['trigger:C']).toEqual({
        name: 'trigger:C',
        type: 'trigger',
      })
      // A has ConditionalWrite for each target
      expect(result.nodeStrategies['A']).toEqual([
        { type: 'conditional', channel: 'trigger:B', target: 'B' },
        { type: 'conditional', channel: 'trigger:C', target: 'C' },
      ])
      // B and C triggered by their respective trigger channels
      expect(result.nodeTriggeredBy['B']).toBe('trigger:B')
      expect(result.nodeTriggeredBy['C']).toBe('trigger:C')
    })

    it('should handle mixed conditional + normal join without barrier-skip-for', () => {
      // A→[B, C] (conditional) + B→D, C→D (normal join)
      const edges: Array<PlainEdge | ConditionalEdge> = [
        { from: 'A', targets: ['B', 'C'], fn: routeFn },
        { from: 'B', to: 'D' },
        { from: 'C', to: 'D' },
      ]
      const result = generateChannels(['A', 'B', 'C', 'D'], edges)

      // trigger:B and trigger:C from conditional
      expect(result.channels['trigger:B']).toBeDefined()
      expect(result.channels['trigger:C']).toBeDefined()
      // barrier:D from B→D, C→D join
      expect(result.channels['barrier:D']).toEqual({
        name: 'barrier:D',
        type: 'barrier',
        writers: ['B', 'C'],
      })
      // A has ConditionalWrite to trigger:B and trigger:C
      expect(result.nodeStrategies['A']).toEqual([
        { type: 'conditional', channel: 'trigger:B', target: 'B' },
        { type: 'conditional', channel: 'trigger:C', target: 'C' },
      ])
      // B and C each have DirectWrite to barrier:D
      expect(result.nodeStrategies['B']).toEqual([{ type: 'direct', channel: 'barrier:D' }])
      expect(result.nodeStrategies['C']).toEqual([{ type: 'direct', channel: 'barrier:D' }])
      // NO barrier-skip-for entries (deleted feature) — verify only 'direct' and 'conditional' types exist
      const allStrategies = Object.values(result.nodeStrategies).flat()
      for (const s of allStrategies) {
        expect(['direct', 'conditional']).toContain(s.type)
      }
    })

    it('should give ConditionalWrite to conditional sources of barrier channels', () => {
      // R→[X, Y] (conditional) + A→Y (plain)
      // Target Y has sources: [R (conditional), A (non-conditional)] → barrier:Y
      // R should get ConditionalWrite to barrier:Y (only writes when route selects Y)
      // A should get DirectWrite to barrier:Y
      const edges: Array<PlainEdge | ConditionalEdge> = [
        { from: 'R', targets: ['X', 'Y'], fn: routeFn },
        { from: 'A', to: 'Y' },
      ]
      const result = generateChannels(['R', 'X', 'Y', 'A'], edges)

      expect(result.channels['barrier:Y']).toEqual({
        name: 'barrier:Y',
        type: 'barrier',
        writers: ['R', 'A'],
      })
      // R has ConditionalWrite to barrier:Y and ConditionalWrite to trigger:X
      expect(result.nodeStrategies['R']).toEqual([
        { type: 'conditional', channel: 'trigger:X', target: 'X' },
        { type: 'conditional', channel: 'barrier:Y', target: 'Y' },
      ])
      // A has DirectWrite to barrier:Y
      expect(result.nodeStrategies['A']).toEqual([{ type: 'direct', channel: 'barrier:Y' }])
    })

    it('should reject multiple conditional edges from the same source node', () => {
      const edges: ConditionalEdge[] = [
        { from: 'A', targets: ['B'], fn: routeFn },
        { from: 'A', targets: ['C'], fn: routeFn },
      ]
      expect(() => generateChannels(['A', 'B', 'C'], edges)).toThrow('multiple conditional edges')
    })

    it('should set nodeTriggeredBy correctly', () => {
      // A→B: B.triggeredBy = 'trigger:B'
      // A→C, B→C: C.triggeredBy = 'barrier:C'
      const edges: PlainEdge[] = [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' },
        { from: 'B', to: 'C' },
      ]
      const result = generateChannels(['A', 'B', 'C'], edges)

      expect(result.nodeTriggeredBy['B']).toBe('trigger:B')
      expect(result.nodeTriggeredBy['C']).toBe('barrier:C')
      // A has no triggeredBy (it is an entry node)
      expect(result.nodeTriggeredBy['A']).toBeUndefined()
    })

    it('should set routeTargets for conditional edge sources', () => {
      // A→[B, C]: A.routeTargets should capture fn and targets
      const edges: ConditionalEdge[] = [{ from: 'A', targets: ['B', 'C'], fn: routeFn }]
      const result = generateChannels(['A', 'B', 'C'], edges)

      expect(result.routeTargets['A']).toEqual({
        fn: routeFn,
        targets: ['B', 'C'],
      })
    })

    it('should initialize strategies for all nodes even if they have no edges', () => {
      const edges: PlainEdge[] = [{ from: 'A', to: 'B' }]
      const result = generateChannels(['A', 'B', 'C'], edges)

      expect(result.nodeStrategies['A']).toEqual([{ type: 'direct', channel: 'trigger:B' }])
      expect(result.nodeStrategies['B']).toEqual([])
      // C has no edges at all, still gets initialized
      expect(result.nodeStrategies['C']).toEqual([])
    })

    it('should handle duplicate source (plain + conditional from same source to same target)', () => {
      // A→B (plain) + A→[B] (conditional) — same source A targeting B via two edge types
      // B has multiple sources (both from A) → barrier channel
      const edges: Array<PlainEdge | ConditionalEdge> = [
        { from: 'A', to: 'B' },
        { from: 'A', targets: ['B'], fn: routeFn },
      ]
      const result = generateChannels(['A', 'B'], edges)

      // B has multiple source entries → barrier channel
      expect(result.channels['barrier:B']).toBeDefined()
      // A has both DirectWrite (from plain edge) and ConditionalWrite (from conditional edge)
      const aStrategies = result.nodeStrategies['A']!
      expect(aStrategies).toEqual([
        { type: 'direct', channel: 'barrier:B' },
        { type: 'conditional', channel: 'barrier:B', target: 'B' },
      ])
    })
  })
})
