import { describe, it, expect } from 'vitest'
import type { Edge } from '../../src/shared/models/graph.js'
import {
  validateGraph,
  checkMissingDeps,
  checkInvalidStatus,
  checkCycles,
  checkOrphans,
  formatValidationResults,
} from '../../src/domain/graph/validator.js'

describe('validateGraph', () => {
  it('should return empty-graph warning for empty node list and edges', () => {
    const results = validateGraph([], [])
    expect(results).toHaveLength(1)
    expect(results[0]!.rule).toBe('empty-graph')
    expect(results[0]!.passed).toBe(true)
    expect(results[0]!.level).toBe('warning')
    expect(results[0]!.message).toContain('empty')
  })
})

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

  it('should report error mentioning from side when from node is missing', () => {
    const edges: Edge[] = [{ from: 'missing-from', to: 'b' }]
    const nodeNames = new Set(['b'])
    const results = checkMissingDeps(edges, nodeNames)
    expect(results.length).toBeGreaterThan(0)
    const fromResult = results.find((r) => r.message.includes("'missing-from'"))
    expect(fromResult).toBeDefined()
    expect(fromResult!.passed).toBe(false)
    expect(fromResult!.level).toBe('error')
    expect(fromResult!.message).toContain('from')
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

  it('should return hint message directly for empty-graph result', () => {
    const results = [
      {
        rule: 'empty-graph',
        passed: true,
        level: 'warning' as const,
        message: 'task graph is empty, nothing to validate',
      },
    ]
    const formatted = formatValidationResults(results)
    expect(formatted).toBe('task graph is empty, nothing to validate')
    expect(formatted).not.toContain('[ERROR]')
    expect(formatted).not.toContain('[WARNING]')
  })

  it('should not include [WARNING] lines when only errors are present', () => {
    const results = [
      {
        rule: 'missing-dep',
        passed: false,
        level: 'error' as const,
        message: "edge references non-existent node 'x'",
      },
    ]
    const formatted = formatValidationResults(results)
    expect(formatted).toContain('[ERROR]')
    expect(formatted).not.toContain('[WARNING]')
  })

  it('should not include [ERROR] lines when only warnings are present', () => {
    const results = [
      {
        rule: 'orphan',
        passed: false,
        level: 'warning' as const,
        message: "node 'lonely' is orphaned (no dependencies)",
      },
    ]
    const formatted = formatValidationResults(results)
    expect(formatted).not.toContain('[ERROR]')
    expect(formatted).toContain('[WARNING]')
  })

  it('should include both [ERROR] and [WARNING] sections when both exist', () => {
    const results = [
      {
        rule: 'missing-dep',
        passed: false,
        level: 'error' as const,
        message: "edge references non-existent node 'x'",
      },
      {
        rule: 'orphan',
        passed: false,
        level: 'warning' as const,
        message: "node 'lonely' is orphaned (no dependencies)",
      },
    ]
    const formatted = formatValidationResults(results)
    expect(formatted).toContain('[ERROR]')
    expect(formatted).toContain('[WARNING]')
    const lines = formatted.split('\n')
    const errorLine = lines.find((l) => l.includes('[ERROR]'))
    const warningLine = lines.find((l) => l.includes('[WARNING]'))
    expect(errorLine).toBeDefined()
    expect(warningLine).toBeDefined()
    // Errors should come before warnings
    expect(formatted.indexOf('[ERROR]')).toBeLessThan(formatted.indexOf('[WARNING]'))
  })
})
