import type { Edge } from '../shared/models/graph.js'
import type { CondEdgeDef, FanOutDef } from '../shared/models/workflow-def.js'

/**
 * Internal builder state for a node created by node(fn, stateKey?)
 */
export interface NodeBuilderState {
  fn: (state: any) => void
  stateKey?: string
}

/**
 * Internal builder state for a workflow being constructed
 */
export interface WorkflowBuilderState {
  name: string
  stateSchema: Record<string, unknown>
  nodes: Array<{ name: string; builder: NodeBuilderState }>
  edges: Edge[]
  condEdges: CondEdgeDef[]
  fanOuts: FanOutDef[]
  /** Nodes connected from START (entry points) */
  entryNodes: string[]
  /** Nodes connected to END (exit points) */
  exitNodes: string[]
}
