import { describe, it, expect } from 'vitest'
import { validateWorkflow } from '../../../src/domain/compiler/validator.js'
import { ValidationError } from '../../../src/shared/errors.js'
import type { WorkflowDefinition } from '../../../src/shared/models/compiled-graph.js'

/** Helper to build a minimal valid WorkflowDefinition */
function baseDef(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: 'test',
    stateSchema: { result: null },
    nodes: [{ name: 'A', fn: (s) => s }],
    edges: [],
    ...overrides,
  }
}

describe('validator', () => {
  describe('validateWorkflow', () => {
    it('should pass for a valid minimal workflow', () => {
      expect(validateWorkflow(baseDef()).isOk()).toBe(true)
    })

    it('should reject empty state schema', () => {
      const result = validateWorkflow(baseDef({ stateSchema: {} }))
      expect(result.isErr()).toBe(true)
    })

    it('should reject empty nodes', () => {
      const result = validateWorkflow(baseDef({ nodes: [] }))
      expect(result.isErr()).toBe(true)
    })

    it('should reject duplicate node names', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'A', fn: (s) => s },
          ],
        }),
      )
      expect(result.isErr()).toBe(true)
    })

    it('should reject edge referencing unknown source', () => {
      const result = validateWorkflow(
        baseDef({
          edges: [{ from: 'X', to: 'A' }],
        }),
      )
      expect(result.isErr()).toBe(true)
    })

    it('should reject edge referencing unknown target', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [{ name: 'A', fn: (s) => s }],
          edges: [{ from: 'A', to: 'Z' }],
        }),
      )
      expect(result.isErr()).toBe(true)
    })

    it('should reject conditional edge referencing unknown source', () => {
      const result = validateWorkflow(
        baseDef({
          edges: [{ from: 'X', targets: ['A'], fn: () => ['A'] }],
        }),
      )
      expect(result.isErr()).toBe(true)
    })

    it('should reject conditional edge referencing unknown target', () => {
      const result = validateWorkflow(
        baseDef({
          edges: [{ from: 'A', targets: ['Z'], fn: () => ['Z'] }],
        }),
      )
      expect(result.isErr()).toBe(true)
    })

    it('should reject conditional edge with empty targets', () => {
      const result = validateWorkflow(
        baseDef({
          edges: [{ from: 'A', targets: [], fn: () => [] }],
        }),
      )
      expect(result.isErr()).toBe(true)
    })

    it('should reject cycle in normal edges (A→B→C→A)', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'B', fn: (s) => s },
            { name: 'C', fn: (s) => s },
          ],
          edges: [
            { from: 'A', to: 'B' },
            { from: 'B', to: 'C' },
            { from: 'C', to: 'A' },
          ],
        }),
      )
      expect(result.isErr()).toBe(true)
    })

    it('should reject cycle involving conditional edges', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'B', fn: (s) => s },
          ],
          edges: [
            { from: 'A', to: 'B' },
            { from: 'B', targets: ['A'], fn: () => ['A'] },
          ],
        }),
      )
      expect(result.isErr()).toBe(true)
    })

    it('should collect multiple errors in one result', () => {
      const def: WorkflowDefinition = {
        name: 'test',
        stateSchema: {},
        nodes: [],
        edges: [{ from: 'X', to: 'Y' }],
      }
      const result = validateWorkflow(def)
      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ValidationError)
        expect(result.error.errors.length).toBeGreaterThanOrEqual(2)
      }
    })

    it('should include descriptive error for empty state schema', () => {
      const result = validateWorkflow(baseDef({ stateSchema: {} }))
      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ValidationError)
        expect(result.error.errors[0]).toContain('state schema')
      }
    })

    it('should include descriptive error for duplicate nodes', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'A', fn: (s) => s },
          ],
        }),
      )
      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ValidationError)
        expect(result.error.errors[0]).toContain('duplicate')
      }
    })

    it('should pass for workflow with plain edges only', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'B', fn: (s) => s },
          ],
          edges: [{ from: 'A', to: 'B' }],
        }),
      )
      expect(result.isOk()).toBe(true)
    })

    it('should pass for workflow with conditional edges only', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'B', fn: (s) => s },
          ],
          edges: [{ from: 'A', targets: ['B'], fn: () => ['B'] }],
        }),
      )
      expect(result.isOk()).toBe(true)
    })
  })

  describe('reachability / orphan detection', () => {
    it('should allow single node with no edges', () => {
      expect(validateWorkflow(baseDef()).isOk()).toBe(true)
    })

    it('should allow two nodes connected by plain edge', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'B', fn: (s) => s },
          ],
          edges: [{ from: 'A', to: 'B' }],
        }),
      )
      expect(result.isOk()).toBe(true)
    })

    it('should allow linear chain A→B→C', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'B', fn: (s) => s },
            { name: 'C', fn: (s) => s },
          ],
          edges: [
            { from: 'A', to: 'B' },
            { from: 'B', to: 'C' },
          ],
        }),
      )
      expect(result.isOk()).toBe(true)
    })

    it('should allow diamond A→B, A→C, B→D, C→D', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'B', fn: (s) => s },
            { name: 'C', fn: (s) => s },
            { name: 'D', fn: (s) => s },
          ],
          edges: [
            { from: 'A', to: 'B' },
            { from: 'A', to: 'C' },
            { from: 'B', to: 'D' },
            { from: 'C', to: 'D' },
          ],
        }),
      )
      expect(result.isOk()).toBe(true)
    })

    it('should allow multiple entry nodes A→C, B→C', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'B', fn: (s) => s },
            { name: 'C', fn: (s) => s },
          ],
          edges: [
            { from: 'A', to: 'C' },
            { from: 'B', to: 'C' },
          ],
        }),
      )
      expect(result.isOk()).toBe(true)
    })

    it('should allow conditional edge A→targets[B, C]', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'B', fn: (s) => s },
            { name: 'C', fn: (s) => s },
          ],
          edges: [{ from: 'A', targets: ['B', 'C'], fn: () => ['B'] }],
        }),
      )
      expect(result.isOk()).toBe(true)
    })

    it('should allow mixed plain and conditional edges', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'B', fn: (s) => s },
            { name: 'C', fn: (s) => s },
            { name: 'D', fn: (s) => s },
          ],
          edges: [
            { from: 'A', to: 'B' },
            { from: 'B', targets: ['C', 'D'], fn: () => ['C'] },
          ],
        }),
      )
      expect(result.isOk()).toBe(true)
    })

    it('should allow disconnected components with edges (A→B, C→D)', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'B', fn: (s) => s },
            { name: 'C', fn: (s) => s },
            { name: 'D', fn: (s) => s },
          ],
          edges: [
            { from: 'A', to: 'B' },
            { from: 'C', to: 'D' },
          ],
        }),
      )
      expect(result.isOk()).toBe(true)
    })

    it('should reject two nodes with no edges (all orphans)', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'B', fn: (s) => s },
          ],
        }),
      )
      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('orphan')
        expect(result.error.message).toContain("'A'")
        expect(result.error.message).toContain("'B'")
      }
    })

    it('should reject orphan node alongside connected nodes', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'B', fn: (s) => s },
            { name: 'C', fn: (s) => s },
          ],
          edges: [{ from: 'A', to: 'B' }],
        }),
      )
      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('orphan')
        expect(result.error.message).toContain("'C'")
        expect(result.error.message).not.toContain("'A'")
        expect(result.error.message).not.toContain("'B'")
      }
    })

    it('should reject multiple orphan nodes', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'B', fn: (s) => s },
            { name: 'C', fn: (s) => s },
            { name: 'D', fn: (s) => s },
          ],
          edges: [{ from: 'A', to: 'B' }],
        }),
      )
      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain("'C'")
        expect(result.error.message).toContain("'D'")
      }
    })

    it('should reject orphan with conditional edges present', () => {
      const result = validateWorkflow(
        baseDef({
          nodes: [
            { name: 'A', fn: (s) => s },
            { name: 'B', fn: (s) => s },
            { name: 'C', fn: (s) => s },
          ],
          edges: [{ from: 'A', targets: ['B'], fn: () => ['B'] }],
        }),
      )
      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('orphan')
        expect(result.error.message).toContain("'C'")
      }
    })
  })
})
