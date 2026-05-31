import type { Edge, NodeFn } from '../shared/models/compiled-graph.js'

/**
 * Internal builder state for a node created by node(fn)
 */
export interface NodeBuilderState {
  fn: NodeFn
}

/**
 * Internal builder state for a workflow being constructed
 */
export interface WorkflowBuilderState {
  name: string
  stateSchema: Record<string, unknown>
  nodes: Array<{ name: string; builder: NodeBuilderState }>
  edges: Edge[] // unified: PlainEdge | ConditionalEdge
  /** Nodes connected from START (entry points) */
  entryNodes: string[]
  /** Nodes connected to END (exit points) */
  exitNodes: string[]
  /** Workflow metadata */
  version?: string
  description?: string
  author?: string
  repository?: string
  license?: string
}
