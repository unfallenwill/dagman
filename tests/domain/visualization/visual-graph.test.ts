import { describe, it, expect } from 'vitest'
import { buildVisualGraph } from '../../../src/domain/visualization/visual-graph.js'
import type {
  CompiledGraph,
  WorkflowDefinition,
  PlainEdge,
  ConditionalEdge,
} from '../../../src/shared/models/compiled-graph.js'

// ─── Helpers ────────────────────────────────────────────────────────

const identity = (s: Record<string, unknown>) => s

function baseDef(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    name: 'test',
    stateSchema: { result: null },
    nodes: [{ name: 'A', fn: identity }],
    edges: [],
    ...overrides,
  }
}

function baseGraph(overrides: Partial<CompiledGraph> = {}): CompiledGraph {
  return {
    name: 'test',
    nodes: {},
    stateSchema: { result: null },
    channels: {},
    layers: [['A']],
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('visual-graph', () => {
  describe('buildVisualGraph', () => {
    it('should add START and END virtual nodes', () => {
      const def = baseDef()
      const graph = baseGraph()
      const result = buildVisualGraph(def, graph)

      const ids = result.nodes.map((n) => n.id)
      expect(ids).toContain('START')
      expect(ids).toContain('END')
    })

    it('should mark START and END as virtual', () => {
      const def = baseDef()
      const graph = baseGraph()
      const result = buildVisualGraph(def, graph)

      const startNode = result.nodes.find((n) => n.id === 'START')
      const endNode = result.nodes.find((n) => n.id === 'END')
      expect(startNode?.isVirtual).toBe(true)
      expect(endNode?.isVirtual).toBe(true)
    })

    it('should mark real nodes as non-virtual', () => {
      const def = baseDef()
      const graph = baseGraph()
      const result = buildVisualGraph(def, graph)

      const realNodes = result.nodes.filter((n) => !n.isVirtual)
      expect(realNodes).toHaveLength(1)
      expect(realNodes[0]!.id).toBe('A')
    })

    // ── Layers ──────────────────────────────────────────────────────

    it('should build layers with START as layer 0 and END as last', () => {
      const def = baseDef({
        nodes: [
          { name: 'A', fn: identity },
          { name: 'B', fn: identity },
        ],
        edges: [{ from: 'A', to: 'B' }],
      })
      const graph = baseGraph({ layers: [['A'], ['B']] })
      const result = buildVisualGraph(def, graph)

      expect(result.layers[0]).toEqual(['START'])
      expect(result.layers[1]).toEqual(['A'])
      expect(result.layers[2]).toEqual(['B'])
      expect(result.layers[3]).toEqual(['END'])
    })

    it('should assign layer index from compiled graph', () => {
      const def = baseDef({
        nodes: [
          { name: 'A', fn: identity },
          { name: 'B', fn: identity },
        ],
        edges: [{ from: 'A', to: 'B' }],
      })
      const graph = baseGraph({ layers: [['A'], ['B']] })
      const result = buildVisualGraph(def, graph)

      const nodeA = result.nodes.find((n) => n.id === 'A')
      const nodeB = result.nodes.find((n) => n.id === 'B')
      expect(nodeA?.layer).toBe(0)
      expect(nodeB?.layer).toBe(1)
    })

    // ── START/END edge synthesis ────────────────────────────────────

    it('should synthesize START → entry node edge', () => {
      const def = baseDef()
      const graph = baseGraph()
      const result = buildVisualGraph(def, graph)

      const startEdges = result.edges.filter((e) => e.from === 'START')
      expect(startEdges).toHaveLength(1)
      expect(startEdges[0]!.to).toBe('A')
      expect(startEdges[0]!.conditional).toBe(false)
    })

    it('should synthesize exit node → END edge', () => {
      const def = baseDef()
      const graph = baseGraph()
      const result = buildVisualGraph(def, graph)

      const endEdges = result.edges.filter((e) => e.to === 'END')
      expect(endEdges).toHaveLength(1)
      expect(endEdges[0]!.from).toBe('A')
      expect(endEdges[0]!.conditional).toBe(false)
    })

    // ── Linear chain ────────────────────────────────────────────────

    it('should build correct edges for linear chain A→B→C', () => {
      const def = baseDef({
        nodes: [
          { name: 'A', fn: identity },
          { name: 'B', fn: identity },
          { name: 'C', fn: identity },
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'B', to: 'C' },
        ] as PlainEdge[],
      })
      const graph = baseGraph({ layers: [['A'], ['B'], ['C']] })
      const result = buildVisualGraph(def, graph)

      // Real edges
      const realEdges = result.edges.filter((e) => e.from !== 'START' && e.to !== 'END')
      expect(realEdges).toHaveLength(2)
      expect(realEdges.find((e) => e.from === 'A' && e.to === 'B')).toBeDefined()
      expect(realEdges.find((e) => e.from === 'B' && e.to === 'C')).toBeDefined()

      // All real edges are non-conditional
      for (const e of realEdges) {
        expect(e.conditional).toBe(false)
      }
    })

    // ── Parallel fan-out ────────────────────────────────────────────

    it('should handle fan-out A→B, A→C with START→A only once', () => {
      const def = baseDef({
        nodes: [
          { name: 'A', fn: identity },
          { name: 'B', fn: identity },
          { name: 'C', fn: identity },
        ],
        edges: [
          { from: 'A', to: 'B' },
          { from: 'A', to: 'C' },
        ] as PlainEdge[],
      })
      const graph = baseGraph({ layers: [['A'], ['B', 'C']] })
      const result = buildVisualGraph(def, graph)

      const startEdges = result.edges.filter((e) => e.from === 'START')
      expect(startEdges).toHaveLength(1) // Only one START→A
      expect(startEdges[0]!.to).toBe('A')
    })

    // ── Barrier fan-in ──────────────────────────────────────────────

    it('should handle fan-in A→C, B→C with C→END only once', () => {
      const def = baseDef({
        nodes: [
          { name: 'A', fn: identity },
          { name: 'B', fn: identity },
          { name: 'C', fn: identity },
        ],
        edges: [
          { from: 'A', to: 'C' },
          { from: 'B', to: 'C' },
        ] as PlainEdge[],
      })
      const graph = baseGraph({ layers: [['A', 'B'], ['C']] })
      const result = buildVisualGraph(def, graph)

      const endEdges = result.edges.filter((e) => e.to === 'END')
      expect(endEdges).toHaveLength(1) // Only one C→END
      expect(endEdges[0]!.from).toBe('C')
    })

    // ── Conditional edges ───────────────────────────────────────────

    it('should mark conditional edges', () => {
      const routeFn = (_s: Record<string, unknown>) => ['B']
      const def = baseDef({
        nodes: [
          { name: 'A', fn: identity },
          { name: 'B', fn: identity },
          { name: 'C', fn: identity },
        ],
        edges: [{ from: 'A', targets: ['B', 'C'], fn: routeFn }] as ConditionalEdge[],
      })
      const graph = baseGraph({ layers: [['A'], ['B', 'C']] })
      const result = buildVisualGraph(def, graph)

      const condEdges = result.edges.filter((e) => e.conditional)
      expect(condEdges).toHaveLength(2)
      expect(condEdges.map((e) => e.to).sort()).toEqual(['B', 'C'])
      for (const e of condEdges) {
        expect(e.from).toBe('A')
      }
    })

    it('should keep plain edges non-conditional alongside conditional edges', () => {
      const routeFn = (_s: Record<string, unknown>) => ['B']
      const def = baseDef({
        nodes: [
          { name: 'A', fn: identity },
          { name: 'B', fn: identity },
          { name: 'C', fn: identity },
          { name: 'D', fn: identity },
        ],
        edges: [
          { from: 'A', targets: ['B', 'C'], fn: routeFn },
          { from: 'B', to: 'D' },
          { from: 'C', to: 'D' },
        ] as Array<PlainEdge | ConditionalEdge>,
      })
      const graph = baseGraph({ layers: [['A'], ['B', 'C'], ['D']] })
      const result = buildVisualGraph(def, graph)

      const realEdges = result.edges.filter((e) => e.from !== 'START' && e.to !== 'END')
      const condEdges = realEdges.filter((e) => e.conditional)
      const plainEdges = realEdges.filter((e) => !e.conditional)

      expect(condEdges).toHaveLength(2) // A→B, A→C
      expect(plainEdges).toHaveLength(2) // B→D, C→D
    })

    // ── Single node ─────────────────────────────────────────────────

    it('should handle single node workflow', () => {
      const def = baseDef()
      const graph = baseGraph()
      const result = buildVisualGraph(def, graph)

      // Layers: [START], [A], [END]
      expect(result.layers).toEqual([['START'], ['A'], ['END']])

      // Edges: START→A, A→END
      expect(result.edges).toHaveLength(2)
      expect(result.edges[0]).toEqual({ from: 'START', to: 'A', conditional: false })
      expect(result.edges[1]).toEqual({ from: 'A', to: 'END', conditional: false })
    })

    // ── Multi-entry / multi-exit ────────────────────────────────────

    it('should synthesize START→each entry node for multiple entries', () => {
      const def = baseDef({
        nodes: [
          { name: 'A', fn: identity },
          { name: 'B', fn: identity },
          { name: 'C', fn: identity },
        ],
        edges: [
          { from: 'A', to: 'C' },
          { from: 'B', to: 'C' },
        ] as PlainEdge[],
      })
      const graph = baseGraph({ layers: [['A', 'B'], ['C']] })
      const result = buildVisualGraph(def, graph)

      const startEdges = result.edges.filter((e) => e.from === 'START')
      expect(startEdges).toHaveLength(2)
      expect(startEdges.map((e) => e.to).sort()).toEqual(['A', 'B'])
    })
  })
})
