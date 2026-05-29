import { describe, it, expect } from 'vitest'
import type { Edge } from '../../src/shared/models/graph.js'
import {
  checkMissingDeps,
  checkInvalidStatus,
  checkCycles,
  checkOrphans,
  formatValidationResults,
} from '../../src/graph/validator.js'

describe('checkMissingDeps', () => {
  it('should pass when all edge targets exist', () => {
    const edges: Edge[] = [{ from: 'a', to: 'b' }]
    const nodeNames = new Set(['a', 'b'])
    const results = checkMissingDeps(edges, nodeNames)
    expect(results.every((r) => r.passed)).toBe(true)
  })

  it('should report error for missing edge target', () => {
    const edges: Edge[] = [{ from: 'a', to: 'nonexistent' }]
    const nodeNames = new Set(['a'])
    const results = checkMissingDeps(edges, nodeNames)
    expect(results.some((r) => r.level === 'error' && !r.passed)).toBe(true)
  })
})

describe('checkInvalidStatus', () => {
  it('should pass when expect is valid', () => {
    const edges: Edge[] = [{ from: 'a', to: 'b', expect: 'success' }]
    const results = checkInvalidStatus(edges)
    expect(results.every((r) => r.passed)).toBe(true)
  })

  it('should pass when expect is undefined (defaults to success)', () => {
    const edges: Edge[] = [{ from: 'a', to: 'b' }]
    const results = checkInvalidStatus(edges)
    expect(results.length).toBe(0)
  })

  it('should report error when expect is invalid', () => {
    const edges: Edge[] = [{ from: 'a', to: 'b', expect: 'invalid_status' as 'success' }]
    const results = checkInvalidStatus(edges)
    expect(results.some((r) => r.level === 'error' && !r.passed)).toBe(true)
  })
})

describe('checkCycles', () => {
  it('should pass with no cycles', () => {
    const edges: Edge[] = [{ from: 'a', to: 'b' }]
    const results = checkCycles(edges)
    expect(results.length).toBe(0)
  })

  it('should detect A -> B -> A cycle', () => {
    const edges: Edge[] = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ]
    const results = checkCycles(edges)
    expect(results.some((r) => r.level === 'error')).toBe(true)
    expect(results[0]!.message).toContain('cycle detected')
  })

  it('should detect A -> B -> C -> A cycle', () => {
    const edges: Edge[] = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
    ]
    const results = checkCycles(edges)
    expect(results.some((r) => r.level === 'error')).toBe(true)
  })
})

describe('checkOrphans', () => {
  it('should pass with no orphans', () => {
    const edges: Edge[] = [{ from: 'a', to: 'b' }]
    const nodeNames = new Set(['a', 'b'])
    const results = checkOrphans(edges, nodeNames)
    expect(results.length).toBe(0)
  })

  it('should report warning for orphan nodes', () => {
    const edges: Edge[] = []
    const nodeNames = new Set(['lonely'])
    const results = checkOrphans(edges, nodeNames)
    expect(results.length).toBe(1)
    expect(results[0]!.level).toBe('warning')
    expect(results[0]!.message).toContain('orphaned')
  })
})

describe('formatValidationResults', () => {
  it('should return pass message when no issues', () => {
    const result = formatValidationResults([])
    expect(result).toBe('task graph validation passed, no issues')
  })

  it('should format errors before warnings', () => {
    const results = [
      {
        rule: 'orphan',
        passed: false,
        level: 'warning' as const,
        message: 'orphaned node',
      },
      {
        rule: 'missing',
        passed: false,
        level: 'error' as const,
        message: 'dependency not found',
      },
    ]
    const formatted = formatValidationResults(results)
    const lines = formatted.split('\n')
    expect(lines[0]!).toContain('[ERROR]')
    expect(lines[1]!).toContain('[WARNING]')
  })
})
