import { describe, it, expect } from 'vitest'
import type { Edge } from '../../../src/shared/utils/topology.js'
import {
  buildAdjacencyMap,
  buildReverseAdjacencyMap,
  hasCycle,
  areDepsSatisfied,
  collectUpstream,
  collectDownstream,
  findMissingTargets,
  findOrphanNodes,
  findCyclePaths,
  computeTopologicalLayers,
} from '../../../src/shared/utils/topology.js'

// ---------------------------------------------------------------------------
// buildAdjacencyMap
// ---------------------------------------------------------------------------
describe('buildAdjacencyMap', () => {
  it('should build forward adjacency map for simple edges', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
    ]
    const adj = buildAdjacencyMap(edges)
    expect(adj.get('A')).toEqual(['B', 'C'])
    expect(adj.has('B')).toBe(false)
    expect(adj.has('C')).toBe(false)
  })

  it('should group multiple edges from the same source', () => {
    const edges: Edge[] = [
      { from: 'X', to: 'Y' },
      { from: 'X', to: 'Z' },
      { from: 'X', to: 'W' },
    ]
    const adj = buildAdjacencyMap(edges)
    expect(adj.get('X')).toEqual(['Y', 'Z', 'W'])
    expect(adj.size).toBe(1)
  })

  it('should handle edges from different sources independently', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
    ]
    const adj = buildAdjacencyMap(edges)
    expect(adj.get('A')).toEqual(['B'])
    expect(adj.get('B')).toEqual(['C'])
  })

  it('should return empty map for empty edges', () => {
    const adj = buildAdjacencyMap([])
    expect(adj.size).toBe(0)
  })

  it('should not create entries for pure target nodes', () => {
    const edges: Edge[] = [{ from: 'A', to: 'B' }]
    const adj = buildAdjacencyMap(edges)
    expect(adj.has('B')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildReverseAdjacencyMap
// ---------------------------------------------------------------------------
describe('buildReverseAdjacencyMap', () => {
  it('should build reverse adjacency map for simple edges', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'C', to: 'B' },
    ]
    const adj = buildReverseAdjacencyMap(edges)
    expect(adj.get('B')).toEqual(['A', 'C'])
    expect(adj.has('A')).toBe(false)
    expect(adj.has('C')).toBe(false)
  })

  it('should group multiple edges targeting the same node', () => {
    const edges: Edge[] = [
      { from: 'P', to: 'Q' },
      { from: 'R', to: 'Q' },
      { from: 'S', to: 'Q' },
    ]
    const adj = buildReverseAdjacencyMap(edges)
    expect(adj.get('Q')).toEqual(['P', 'R', 'S'])
    expect(adj.size).toBe(1)
  })

  it('should handle edges to different targets independently', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
    ]
    const adj = buildReverseAdjacencyMap(edges)
    expect(adj.get('B')).toEqual(['A'])
    expect(adj.get('C')).toEqual(['B'])
  })

  it('should return empty map for empty edges', () => {
    const adj = buildReverseAdjacencyMap([])
    expect(adj.size).toBe(0)
  })

  it('should not create entries for pure source nodes', () => {
    const edges: Edge[] = [{ from: 'A', to: 'B' }]
    const adj = buildReverseAdjacencyMap(edges)
    expect(adj.has('A')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// hasCycle
// ---------------------------------------------------------------------------
describe('hasCycle', () => {
  it('should return false for a linear DAG', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'D' },
    ]
    expect(hasCycle(edges)).toBe(false)
  })

  it('should return true for a simple cycle A->B->A', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'A' },
    ]
    expect(hasCycle(edges)).toBe(true)
  })

  it('should return true for a self-loop A->A', () => {
    const edges: Edge[] = [{ from: 'A', to: 'A' }]
    expect(hasCycle(edges)).toBe(true)
  })

  it('should return true for a disconnected graph with a cycle in one component', () => {
    // Component 1: A -> B (no cycle)
    // Component 2: C -> D -> C (cycle)
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'C', to: 'D' },
      { from: 'D', to: 'C' },
    ]
    expect(hasCycle(edges)).toBe(true)
  })

  it('should return false for a disconnected graph with no cycles', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'C', to: 'D' },
    ]
    expect(hasCycle(edges)).toBe(false)
  })

  it('should return false for a diamond DAG', () => {
    // A -> B, A -> C, B -> D, C -> D
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'B', to: 'D' },
      { from: 'C', to: 'D' },
    ]
    expect(hasCycle(edges)).toBe(false)
  })

  it('should return false for empty edges', () => {
    expect(hasCycle([])).toBe(false)
  })

  it('should return true for a longer cycle', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'D' },
      { from: 'D', to: 'A' },
    ]
    expect(hasCycle(edges)).toBe(true)
  })

  it('should return false for a single edge', () => {
    const edges: Edge[] = [{ from: 'X', to: 'Y' }]
    expect(hasCycle(edges)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// areDepsSatisfied
// ---------------------------------------------------------------------------
describe('areDepsSatisfied', () => {
  it('should return true when all deps succeeded', () => {
    const edges: Edge[] = [{ from: 'B', to: 'A' }]
    const states = { A: 'success' }
    expect(areDepsSatisfied('B', edges, states)).toBe(true)
  })

  it('should return true when dep is skipped and expect defaults to success', () => {
    const edges: Edge[] = [{ from: 'B', to: 'A' }]
    const states = { A: 'skipped' }
    expect(areDepsSatisfied('B', edges, states)).toBe(true)
  })

  it('should return false when dep failed', () => {
    const edges: Edge[] = [{ from: 'B', to: 'A' }]
    const states = { A: 'failed' }
    expect(areDepsSatisfied('B', edges, states)).toBe(false)
  })

  it('should return true when node has no deps', () => {
    const edges: Edge[] = [{ from: 'X', to: 'Y' }]
    const states = {}
    expect(areDepsSatisfied('A', edges, states)).toBe(true)
  })

  it('should return true when expect=skipped and dep is skipped', () => {
    const edges: Edge[] = [{ from: 'B', to: 'A', expect: 'skipped' }]
    const states = { A: 'skipped' }
    expect(areDepsSatisfied('B', edges, states)).toBe(true)
  })

  it('should return false when expect=skipped but dep is success', () => {
    const edges: Edge[] = [{ from: 'B', to: 'A', expect: 'skipped' }]
    const states = { A: 'success' }
    expect(areDepsSatisfied('B', edges, states)).toBe(false)
  })

  it('should return false with mixed succeeded and pending deps', () => {
    const edges: Edge[] = [
      { from: 'C', to: 'A' },
      { from: 'C', to: 'B' },
    ]
    const states = { A: 'success', B: 'pending' }
    expect(areDepsSatisfied('C', edges, states)).toBe(false)
  })

  it('should return false for unknown channel status', () => {
    const edges: Edge[] = [{ from: 'B', to: 'A' }]
    const states = { A: 'unknown_status' }
    expect(areDepsSatisfied('B', edges, states)).toBe(false)
  })

  it('should return false when dep state is missing entirely', () => {
    const edges: Edge[] = [{ from: 'B', to: 'A' }]
    const states = {}
    expect(areDepsSatisfied('B', edges, states)).toBe(false)
  })

  it('should return true when multiple deps all succeeded', () => {
    const edges: Edge[] = [
      { from: 'C', to: 'A' },
      { from: 'C', to: 'B' },
    ]
    const states = { A: 'success', B: 'success' }
    expect(areDepsSatisfied('C', edges, states)).toBe(true)
  })

  it('should return true when one dep skipped and other succeeded', () => {
    const edges: Edge[] = [
      { from: 'C', to: 'A' },
      { from: 'C', to: 'B' },
    ]
    const states = { A: 'success', B: 'skipped' }
    expect(areDepsSatisfied('C', edges, states)).toBe(true)
  })

  it('should return false when one dep failed and other succeeded', () => {
    const edges: Edge[] = [
      { from: 'C', to: 'A' },
      { from: 'C', to: 'B' },
    ]
    const states = { A: 'success', B: 'failed' }
    expect(areDepsSatisfied('C', edges, states)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// collectUpstream
// ---------------------------------------------------------------------------
describe('collectUpstream', () => {
  it('should collect direct upstream nodes', () => {
    const edges: Edge[] = [
      { from: 'C', to: 'A' },
      { from: 'C', to: 'B' },
    ]
    expect(collectUpstream('C', edges)).toEqual(['A', 'B'])
  })

  it('should return empty array for node with no edges', () => {
    const edges: Edge[] = [{ from: 'A', to: 'B' }]
    expect(collectUpstream('Z', edges)).toEqual([])
  })

  it('should return only direct upstream, not transitive', () => {
    // A -> B -> C: for C, only B is direct upstream
    const edges: Edge[] = [
      { from: 'B', to: 'A' },
      { from: 'C', to: 'B' },
    ]
    expect(collectUpstream('C', edges)).toEqual(['B'])
  })

  it('should return empty array for empty edges', () => {
    expect(collectUpstream('A', [])).toEqual([])
  })

  it('should collect multiple upstream nodes from diamond pattern', () => {
    // D depends on B and C; B and C both depend on A
    const edges: Edge[] = [
      { from: 'B', to: 'A' },
      { from: 'C', to: 'A' },
      { from: 'D', to: 'B' },
      { from: 'D', to: 'C' },
    ]
    expect(collectUpstream('D', edges)).toEqual(['B', 'C'])
  })
})

// ---------------------------------------------------------------------------
// collectDownstream
// ---------------------------------------------------------------------------
describe('collectDownstream', () => {
  it('should collect direct downstream nodes', () => {
    const edges: Edge[] = [
      { from: 'B', to: 'A' },
      { from: 'C', to: 'A' },
    ]
    expect(collectDownstream('A', edges)).toEqual(['B', 'C'])
  })

  it('should return empty array for node with no edges', () => {
    const edges: Edge[] = [{ from: 'A', to: 'B' }]
    expect(collectDownstream('Z', edges)).toEqual([])
  })

  it('should return only direct downstream, not transitive', () => {
    // A -> B -> C: for A, only B is direct downstream
    const edges: Edge[] = [
      { from: 'B', to: 'A' },
      { from: 'C', to: 'B' },
    ]
    expect(collectDownstream('A', edges)).toEqual(['B'])
  })

  it('should return empty array for empty edges', () => {
    expect(collectDownstream('A', [])).toEqual([])
  })

  it('should collect downstream from diamond pattern root', () => {
    // A -> B, A -> C, B -> D, C -> D
    const edges: Edge[] = [
      { from: 'B', to: 'A' },
      { from: 'C', to: 'A' },
      { from: 'D', to: 'B' },
      { from: 'D', to: 'C' },
    ]
    expect(collectDownstream('A', edges)).toEqual(['B', 'C'])
  })
})

// ---------------------------------------------------------------------------
// findMissingTargets
// ---------------------------------------------------------------------------
describe('findMissingTargets', () => {
  it('should find edge with missing from node', () => {
    const edges: Edge[] = [{ from: 'X', to: 'A' }]
    const nodeNames = new Set(['A'])
    const result = findMissingTargets(edges, nodeNames)
    expect(result).toEqual([{ edge: { from: 'X', to: 'A' }, side: 'from' }])
  })

  it('should find edge with missing to node', () => {
    const edges: Edge[] = [{ from: 'A', to: 'X' }]
    const nodeNames = new Set(['A'])
    const result = findMissingTargets(edges, nodeNames)
    expect(result).toEqual([{ edge: { from: 'A', to: 'X' }, side: 'to' }])
  })

  it('should find edge with both sides missing', () => {
    const edges: Edge[] = [{ from: 'X', to: 'Y' }]
    const nodeNames = new Set(['A'])
    const result = findMissingTargets(edges, nodeNames)
    expect(result).toEqual([
      { edge: { from: 'X', to: 'Y' }, side: 'from' },
      { edge: { from: 'X', to: 'Y' }, side: 'to' },
    ])
  })

  it('should return empty array when all targets present', () => {
    const edges: Edge[] = [{ from: 'A', to: 'B' }]
    const nodeNames = new Set(['A', 'B'])
    expect(findMissingTargets(edges, nodeNames)).toEqual([])
  })

  it('should return only missing entries from mixed edges', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'C', to: 'D' },
      { from: 'A', to: 'X' },
    ]
    const nodeNames = new Set(['A', 'B'])
    const result = findMissingTargets(edges, nodeNames)
    expect(result).toEqual([
      { edge: { from: 'C', to: 'D' }, side: 'from' },
      { edge: { from: 'C', to: 'D' }, side: 'to' },
      { edge: { from: 'A', to: 'X' }, side: 'to' },
    ])
  })

  it('should return empty array for empty edges', () => {
    expect(findMissingTargets([], new Set(['A']))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// findOrphanNodes
// ---------------------------------------------------------------------------
describe('findOrphanNodes', () => {
  it('should return empty array when all nodes are connected', () => {
    const edges: Edge[] = [{ from: 'A', to: 'B' }]
    const nodeNames = new Set(['A', 'B'])
    expect(findOrphanNodes(edges, nodeNames)).toEqual([])
  })

  it('should find a single orphan node', () => {
    const edges: Edge[] = [{ from: 'A', to: 'B' }]
    const nodeNames = new Set(['A', 'B', 'C'])
    const orphans = findOrphanNodes(edges, nodeNames)
    expect(orphans).toEqual(['C'])
  })

  it('should find multiple orphan nodes among connected ones', () => {
    const edges: Edge[] = [{ from: 'A', to: 'B' }]
    const nodeNames = new Set(['A', 'B', 'C', 'D'])
    const orphans = findOrphanNodes(edges, nodeNames)
    expect(orphans.sort()).toEqual(['C', 'D'])
  })

  it('should treat all nodes as orphans when there are no edges', () => {
    const nodeNames = new Set(['A', 'B', 'C'])
    const orphans = findOrphanNodes([], nodeNames)
    expect(orphans.sort()).toEqual(['A', 'B', 'C'])
  })

  it('should return empty for empty nodeNames regardless of edges', () => {
    const edges: Edge[] = [{ from: 'X', to: 'Y' }]
    expect(findOrphanNodes(edges, new Set())).toEqual([])
  })

  it('should return empty for both empty edges and empty nodeNames', () => {
    expect(findOrphanNodes([], new Set())).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// findCyclePaths
// ---------------------------------------------------------------------------
describe('findCyclePaths', () => {
  it('should return empty array when there is no cycle', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
    ]
    expect(findCyclePaths(edges)).toEqual([])
  })

  it('should find simple cycle A->B->A', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'A' },
    ]
    const cycles = findCyclePaths(edges)
    expect(cycles.length).toBeGreaterThanOrEqual(1)
    // The cycle path should contain both A and B
    const cycle = cycles[0]
    expect(cycle).toContain('A')
    expect(cycle).toContain('B')
  })

  it('should find longer cycle A->B->C->A', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'A' },
    ]
    const cycles = findCyclePaths(edges)
    expect(cycles.length).toBeGreaterThanOrEqual(1)
    const cycle = cycles[0]
    expect(cycle).toContain('A')
    expect(cycle).toContain('B')
    expect(cycle).toContain('C')
  })

  it('should find two separate cycles', () => {
    // Cycle 1: A -> B -> A
    // Cycle 2: C -> D -> C
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'A' },
      { from: 'C', to: 'D' },
      { from: 'D', to: 'C' },
    ]
    const cycles = findCyclePaths(edges)
    expect(cycles.length).toBe(2)
  })

  it('should return empty for self-loop-free DAG', () => {
    const edges: Edge[] = [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'B', to: 'D' },
      { from: 'C', to: 'D' },
    ]
    expect(findCyclePaths(edges)).toEqual([])
  })

  it('should return empty for empty edges', () => {
    expect(findCyclePaths([])).toEqual([])
  })

  it('should find self-loop cycle', () => {
    const edges: Edge[] = [{ from: 'A', to: 'A' }]
    const cycles = findCyclePaths(edges)
    expect(cycles.length).toBeGreaterThanOrEqual(1)
    expect(cycles[0]).toContain('A')
  })
})

// ---------------------------------------------------------------------------
// computeTopologicalLayers
// ---------------------------------------------------------------------------
describe('computeTopologicalLayers', () => {
  it('should layer linear A->B->C as [[A],[B],[C]]', () => {
    // A depends on nothing, B depends on A, C depends on B
    // Edge semantics: from depends on to
    const edges: Edge[] = [
      { from: 'B', to: 'A' },
      { from: 'C', to: 'B' },
    ]
    const layers = computeTopologicalLayers(edges, ['A', 'B', 'C'])
    expect(layers.get(0)).toEqual(['A'])
    expect(layers.get(1)).toEqual(['B'])
    expect(layers.get(2)).toEqual(['C'])
    expect(layers.size).toBe(3)
  })

  it('should layer diamond A->B,A->C,B->D,C->D as [[A],[B,C],[D]]', () => {
    // D depends on B and C; B and C depend on A
    const edges: Edge[] = [
      { from: 'B', to: 'A' },
      { from: 'C', to: 'A' },
      { from: 'D', to: 'B' },
      { from: 'D', to: 'C' },
    ]
    const layers = computeTopologicalLayers(edges, ['A', 'B', 'C', 'D'])
    expect(layers.get(0)).toEqual(['A'])
    expect(layers.get(1)!.sort()).toEqual(['B', 'C'])
    expect(layers.get(2)).toEqual(['D'])
    expect(layers.size).toBe(3)
  })

  it('should place all nodes in layer 0 when there are no edges', () => {
    const layers = computeTopologicalLayers([], ['A', 'B', 'C'])
    expect(layers.size).toBe(1)
    expect(layers.get(0)!.sort()).toEqual(['A', 'B', 'C'])
  })

  it('should return empty map for empty nodeNames', () => {
    const layers = computeTopologicalLayers([], [])
    expect(layers.size).toBe(0)
  })

  it('should exclude nodes with deps on missing nodes (never reachable layer)', () => {
    // Edge references node 'X' which is not in nodeNames
    // B depends on X (missing), C depends on B
    // B's in-degree is 1 (from the edge to X), but X is never in a layer
    // so B's in-degree never decrements to 0, meaning B and C never get assigned
    const edges: Edge[] = [
      { from: 'B', to: 'X' },
      { from: 'C', to: 'B' },
    ]
    const layers = computeTopologicalLayers(edges, ['B', 'C'])
    // Neither B nor C can be assigned because X is never resolved
    expect(layers.size).toBe(0)
  })

  it('should layer a complex multi-level DAG correctly', () => {
    // A -> B, A -> C, B -> D, C -> D, D -> E
    const edges: Edge[] = [
      { from: 'B', to: 'A' },
      { from: 'C', to: 'A' },
      { from: 'D', to: 'B' },
      { from: 'D', to: 'C' },
      { from: 'E', to: 'D' },
    ]
    const layers = computeTopologicalLayers(edges, ['A', 'B', 'C', 'D', 'E'])
    expect(layers.get(0)).toEqual(['A'])
    expect(layers.get(1)!.sort()).toEqual(['B', 'C'])
    expect(layers.get(2)).toEqual(['D'])
    expect(layers.get(3)).toEqual(['E'])
    expect(layers.size).toBe(4)
  })

  it('should handle a single node with no edges', () => {
    const layers = computeTopologicalLayers([], ['Solo'])
    expect(layers.size).toBe(1)
    expect(layers.get(0)).toEqual(['Solo'])
  })

  it('should place independent nodes in the same layer', () => {
    const edges: Edge[] = [{ from: 'C', to: 'A' }]
    const layers = computeTopologicalLayers(edges, ['A', 'B', 'C'])
    // A and B have no deps, C depends on A
    expect(layers.size).toBe(2)
    const layer0 = layers.get(0)!.sort()
    expect(layer0).toEqual(['A', 'B'])
    expect(layers.get(1)).toEqual(['C'])
  })
})
