/**
 * Visual graph model — pure data structure for ASCII DAG rendering.
 *
 * Converts a CompiledGraph + WorkflowDefinition into a layout-friendly
 * representation with virtual START/END nodes and edge type metadata.
 */

import type { CompiledGraph, WorkflowDefinition } from '../../shared/models/compiled-graph.js'
import { isConditionalEdge } from '../../shared/models/compiled-graph.js'

// ─── Types ──────────────────────────────────────────────────────────

export interface VisualNode {
  id: string
  layer: number
  isVirtual: boolean
}

export interface VisualEdge {
  from: string
  to: string
  conditional: boolean
}

export interface VisualGraph {
  nodes: VisualNode[]
  edges: VisualEdge[]
  layers: string[][]
}

// ─── Builder ────────────────────────────────────────────────────────

/**
 * Build a VisualGraph from a compiled graph and its definition.
 *
 * - Derives entry/exit nodes from the edge list
 * - Synthesizes virtual START → entry and exit → END edges
 * - Marks conditional edges from ConditionalEdge types
 */
export function buildVisualGraph(
  definition: WorkflowDefinition,
  graph: CompiledGraph,
): VisualGraph {
  // Derive entry/exit from edges
  const hasIncoming = new Set<string>()
  const hasOutgoing = new Set<string>()

  for (const edge of definition.edges) {
    if (isConditionalEdge(edge)) {
      hasOutgoing.add(edge.from)
      for (const t of edge.targets) {
        hasIncoming.add(t)
      }
    } else {
      hasOutgoing.add(edge.from)
      hasIncoming.add(edge.to)
    }
  }

  const entryNodes = definition.nodes.map((n) => n.name).filter((name) => !hasIncoming.has(name))
  const exitNodes = definition.nodes.map((n) => n.name).filter((name) => !hasOutgoing.has(name))

  // Build visual nodes with layer assignments
  const layerMap = new Map<string, number>()
  graph.layers.forEach((layer, idx) => {
    for (const nodeId of layer) {
      layerMap.set(nodeId, idx)
    }
  })

  const nodes: VisualNode[] = [
    { id: 'START', layer: -1, isVirtual: true },
    { id: 'END', layer: graph.layers.length, isVirtual: true },
    ...definition.nodes.map((n) => ({
      id: n.name,
      layer: layerMap.get(n.name) ?? 0,
      isVirtual: false,
    })),
  ]

  // Build visual edges
  const edges: VisualEdge[] = []

  for (const edge of definition.edges) {
    if (isConditionalEdge(edge)) {
      for (const target of edge.targets) {
        edges.push({ from: edge.from, to: target, conditional: true })
      }
    } else {
      edges.push({ from: edge.from, to: edge.to, conditional: false })
    }
  }

  // Synthesize START → entry and exit → END edges
  for (const entry of entryNodes) {
    edges.push({ from: 'START', to: entry, conditional: false })
  }
  for (const exit of exitNodes) {
    edges.push({ from: exit, to: 'END', conditional: false })
  }

  // Build full layers including virtual START/END
  const layers: string[][] = [['START'], ...graph.layers, ['END']]

  return { nodes, edges, layers }
}
