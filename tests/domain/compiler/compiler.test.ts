import { describe, it, expect, vi, beforeEach } from 'vitest'
import { compile, setDefaultCompilerDeps } from '../../../src/domain/compiler/compiler.js'
import type { WorkflowDefinition } from '../../../src/shared/models/compiled-graph.js'
import { ValidationError } from '../../../src/shared/errors.js'
// ── Mock loader setup ────────────────────────────────────────────────

const mockLoad = vi.fn<(path: string) => Promise<WorkflowDefinition>>()

beforeEach(() => {
  mockLoad.mockReset()
  setDefaultCompilerDeps({
    loader: { load: mockLoad },
    getWorkflowTsFile: (name: string) => `/test/${name}/index.ts`,
  })
})

/** Helper to build a valid WorkflowDefinition */
function makeWorkflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: 'test-workflow',
    stateSchema: { result: null },
    nodes: [
      { name: 'A', fn: () => ({ result: 'a' }) },
      { name: 'B', fn: () => ({ result: 'b' }) },
    ],
    edges: [{ from: 'A', to: 'B' }],
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('compile', () => {
  it('should compile a basic A→B workflow with correct layers, channels, and nodes', async () => {
    mockLoad.mockResolvedValue(makeWorkflow())

    const graph = await compile('test-workflow')

    expect(graph.name).toBe('test-workflow')
    expect(graph.stateSchema).toEqual({ result: null })
    expect(graph.layers).toEqual([['A'], ['B']])
    expect(Object.keys(graph.nodes)).toEqual(['A', 'B'])
    expect(graph.channels['trigger:B']).toEqual({
      name: 'trigger:B',
      type: 'trigger',
    })
    expect(graph.nodes['A']?.id).toBe('A')
    expect(graph.nodes['B']?.id).toBe('B')
    expect(graph.nodes['B']?.triggeredBy).toBe('trigger:B')
  })

  it('should place independent nodes A, B in the same layer', async () => {
    // Two disconnected components — validator rejects orphans, so connect both to C
    mockLoad.mockResolvedValue(
      makeWorkflow({
        nodes: [
          { name: 'A', fn: () => ({ result: 'a' }) },
          { name: 'B', fn: () => ({ result: 'b' }) },
          { name: 'C', fn: () => ({ result: 'c' }) },
        ],
        edges: [
          { from: 'A', to: 'C' },
          { from: 'B', to: 'C' },
        ],
      }),
    )

    const graph = await compile('test-workflow')

    // A and B both have in-degree 0 → layer 0, C depends on both → layer 1
    expect(graph.layers).toEqual([['A', 'B'], ['C']])
  })

  it('should compute three layers for chain A→B→C', async () => {
    mockLoad.mockResolvedValue(
      makeWorkflow({
        nodes: [
          { name: 'A', fn: () => ({ result: 'a' }) },
          { name: 'B', fn: () => ({ result: 'b' }) },
          { name: 'C', fn: () => ({ result: 'c' }) },
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
        ],
      }),
    )

    const graph = await compile('test-workflow')

    expect(graph.layers).toEqual([['A'], ['B'], ['C']])
  })

  it('should set routeTargets on node A when using conditional edges', async () => {
    const routeFn = () => ['B']

    mockLoad.mockResolvedValue(
      makeWorkflow({
        nodes: [
          { name: 'A', fn: () => ({ result: 'a' }) },
          { name: 'B', fn: () => ({ result: 'b' }) },
          { name: 'C', fn: () => ({ result: 'c' }) },
        ],
        edges: [{ from: 'A', targets: ['B', 'C'], fn: routeFn }],
      }),
    )

    const graph = await compile('test-workflow')

    expect(graph.nodes['A']?.route).toBe(routeFn)
    expect(graph.nodes['A']?.routeTargets).toEqual(['B', 'C'])
    // B and C should NOT have route info
    expect(graph.nodes['B']?.route).toBeUndefined()
    expect(graph.nodes['B']?.routeTargets).toBeUndefined()
    expect(graph.nodes['C']?.route).toBeUndefined()
    expect(graph.nodes['C']?.routeTargets).toBeUndefined()
  })

  it('should handle mixed plain and conditional edges', async () => {
    const routeFn = () => ['C']

    mockLoad.mockResolvedValue(
      makeWorkflow({
        nodes: [
          { name: 'A', fn: () => ({ result: 'a' }) },
          { name: 'B', fn: () => ({ result: 'b' }) },
          { name: 'C', fn: () => ({ result: 'c' }) },
          { name: 'D', fn: () => ({ result: 'd' }) },
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', targets: ['C', 'D'], fn: routeFn },
        ],
      }),
    )

    const graph = await compile('test-workflow')

    // Layers: [A], [B], [C, D]
    expect(graph.layers).toEqual([['A'], ['B'], ['C', 'D']])
    // B has route info
    expect(graph.nodes['B']?.route).toBe(routeFn)
    expect(graph.nodes['B']?.routeTargets).toEqual(['C', 'D'])
    // trigger:B from plain edge
    expect(graph.channels['trigger:B']).toBeDefined()
    // trigger:C, trigger:D from conditional edge
    expect(graph.channels['trigger:C']).toBeDefined()
    expect(graph.channels['trigger:D']).toBeDefined()
  })

  it('should include version and description from the definition', async () => {
    mockLoad.mockResolvedValue(
      makeWorkflow({
        version: '1.2.3',
        description: 'A test workflow',
      }),
    )

    const graph = await compile('test-workflow')

    expect(graph.version).toBe('1.2.3')
    expect(graph.description).toBe('A test workflow')
  })

  it('should throw ValidationError for edges referencing non-existent nodes', async () => {
    mockLoad.mockResolvedValue(
      makeWorkflow({
        nodes: [{ name: 'A', fn: () => ({ result: 'a' }) }],
        edges: [{ from: 'A', to: 'Z' }],
      }),
    )

    await expect(compile('test-workflow')).rejects.toThrow(ValidationError)
  })

  it('should throw ValidationError for empty state schema', async () => {
    mockLoad.mockResolvedValue(
      makeWorkflow({
        stateSchema: {},
        nodes: [{ name: 'A', fn: () => ({ result: 'a' }) }],
        edges: [],
      }),
    )

    await expect(compile('test-workflow')).rejects.toThrow(ValidationError)
  })

  it('should return empty graph for single node with no edges', async () => {
    // Single node, no edges — validator allows this (single-node workflow)
    mockLoad.mockResolvedValue(
      makeWorkflow({
        nodes: [{ name: 'A', fn: () => ({ result: 'a' }) }],
        edges: [],
      }),
    )

    const graph = await compile('test-workflow')

    expect(graph.layers).toEqual([['A']])
    expect(Object.keys(graph.nodes)).toEqual(['A'])
    expect(Object.keys(graph.channels)).toEqual([])
  })

  it('should create barrier channel for fan-in A→C, B→C', async () => {
    mockLoad.mockResolvedValue(
      makeWorkflow({
        nodes: [
          { name: 'A', fn: () => ({ result: 'a' }) },
          { name: 'B', fn: () => ({ result: 'b' }) },
          { name: 'C', fn: () => ({ result: 'c' }) },
        ],
        edges: [
          { from: 'A', to: 'C' },
          { from: 'B', to: 'C' },
        ],
      }),
    )

    const graph = await compile('test-workflow')

    expect(graph.layers).toEqual([['A', 'B'], ['C']])
    expect(graph.channels['barrier:C']).toEqual({
      name: 'barrier:C',
      type: 'barrier',
      writers: ['A', 'B'],
    })
    expect(graph.nodes['C']?.triggeredBy).toBe('barrier:C')
    // A and B should have DirectWrite strategies to barrier:C
    expect(graph.nodes['A']?.strategies).toEqual([{ type: 'direct', channel: 'barrier:C' }])
    expect(graph.nodes['B']?.strategies).toEqual([{ type: 'direct', channel: 'barrier:C' }])
  })

  it('should use the workflow name from the argument, not the definition', async () => {
    mockLoad.mockResolvedValue(makeWorkflow())

    const graph = await compile('my-custom-name')

    expect(graph.name).toBe('my-custom-name')
  })

  it('should pass the correct path to the loader via getWorkflowTsFile', async () => {
    mockLoad.mockResolvedValue(makeWorkflow())

    await compile('some-workflow')

    expect(mockLoad).toHaveBeenCalledWith('/test/some-workflow/index.ts')
  })

  it('should compute layers for conditional edges (A routes to [B, C])', async () => {
    const routeFn = () => ['B']

    mockLoad.mockResolvedValue(
      makeWorkflow({
        nodes: [
          { name: 'A', fn: () => ({ result: 'a' }) },
          { name: 'B', fn: () => ({ result: 'b' }) },
          { name: 'C', fn: () => ({ result: 'c' }) },
        ],
        edges: [{ from: 'A', targets: ['B', 'C'], fn: routeFn }],
      }),
    )

    const graph = await compile('test-workflow')

    // A is entry (in-degree 0), B and C both depend on A
    expect(graph.layers).toEqual([['A'], ['B', 'C']])
  })

  it('should throw ValidationError for cycle in edges', async () => {
    mockLoad.mockResolvedValue(
      makeWorkflow({
        nodes: [
          { name: 'A', fn: () => ({ result: 'a' }) },
          { name: 'B', fn: () => ({ result: 'b' }) },
          { name: 'C', fn: () => ({ result: 'c' }) },
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
          { from: 'C', to: 'A' },
        ],
      }),
    )

    await expect(compile('test-workflow')).rejects.toThrow(ValidationError)
  })

  it('should throw ValidationError for orphan nodes', async () => {
    mockLoad.mockResolvedValue(
      makeWorkflow({
        nodes: [
          { name: 'A', fn: () => ({ result: 'a' }) },
          { name: 'B', fn: () => ({ result: 'b' }) },
          { name: 'C', fn: () => ({ result: 'c' }) },
        ],
        edges: [{ from: 'A', to: 'B' }],
      }),
    )

    await expect(compile('test-workflow')).rejects.toThrow(ValidationError)
  })

  it('should handle conditional edges mixed with barrier (A→[B,C], B→D, C→D)', async () => {
    const routeFn = () => ['B']

    mockLoad.mockResolvedValue(
      makeWorkflow({
        nodes: [
          { name: 'A', fn: () => ({ result: 'a' }) },
          { name: 'B', fn: () => ({ result: 'b' }) },
          { name: 'C', fn: () => ({ result: 'c' }) },
          { name: 'D', fn: () => ({ result: 'd' }) },
        ],
        edges: [
          { from: 'A', targets: ['B', 'C'], fn: routeFn },
          { from: 'B', to: 'D' },
          { from: 'C', to: 'D' },
        ],
      }),
    )

    const graph = await compile('test-workflow')

    expect(graph.layers).toEqual([['A'], ['B', 'C'], ['D']])
    // D has barrier channel from B and C
    expect(graph.channels['barrier:D']).toEqual({
      name: 'barrier:D',
      type: 'barrier',
      writers: ['B', 'C'],
    })
  })

  it('should leave version and description undefined when not provided', async () => {
    mockLoad.mockResolvedValue(makeWorkflow())

    const graph = await compile('test-workflow')

    expect(graph.version).toBeUndefined()
    expect(graph.description).toBeUndefined()
  })

  it('should set correct strategies on nodes with conditional edges', async () => {
    const routeFn = () => ['B']

    mockLoad.mockResolvedValue(
      makeWorkflow({
        nodes: [
          { name: 'A', fn: () => ({ result: 'a' }) },
          { name: 'B', fn: () => ({ result: 'b' }) },
          { name: 'C', fn: () => ({ result: 'c' }) },
        ],
        edges: [{ from: 'A', targets: ['B', 'C'], fn: routeFn }],
      }),
    )

    const graph = await compile('test-workflow')

    // A should have ConditionalWrite strategies for B and C
    expect(graph.nodes['A']?.strategies).toEqual([
      { type: 'conditional', channel: 'trigger:B', target: 'B' },
      { type: 'conditional', channel: 'trigger:C', target: 'C' },
    ])
    // B and C should have no strategies (they are leaf nodes)
    expect(graph.nodes['B']?.strategies).toEqual([])
    expect(graph.nodes['C']?.strategies).toEqual([])
  })
})
