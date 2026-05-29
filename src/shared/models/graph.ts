import type { Node } from './node.js'

export interface Edge {
  from: string
  to: string
  expect?: 'success' | 'skipped'
}

export interface Graph {
  name: string
  edges: Edge[]
  /** Embedded nodes from compiled workflow (TS-compiled workflows include nodes) */
  nodes?: Node[]
  /** StateGraph schema (Zod → JSON Schema), for TS-compiled workflows */
  stateSchema?: Record<string, unknown>
  /** Corresponding workflow name in .dagman/workflows/<name>/ */
  workflowName?: string
}
