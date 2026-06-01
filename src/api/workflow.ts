import type { RouteFn, WorkflowDefinition } from '../shared/models/compiled-graph.js'
import { isPlainEdge } from '../shared/models/compiled-graph.js'
import type { NodeBuilder } from './node.js'
import type { WorkflowBuilderState } from './types.js'

export const START: unique symbol = Symbol('START')
export const END: unique symbol = Symbol('END')

type NodeRef = string | typeof START | typeof END

export interface WorkflowBuilder {
  /** Add a named node to the workflow */
  add(name: string, node: NodeBuilder): this
  /** Add a plain edge between two nodes (or START/END) */
  edge(from: NodeRef, to: NodeRef): this
  /** Add a conditional edge — virtual routing node.
   *  Multiple `to` nodes share the same condEdge → candidate competition.
   *  `fn` is evaluated to determine which targets execute. */
  condEdge(from: string, to: string[], fn: RouteFn): this
  /** Embed a child workflow as a subgraph.
   *  Child nodes are prefixed with `name.`, edges are remapped.
   *  Example: .subgraph('process', childDef)
   *    → child node 'step1' becomes 'process.step1'
   *    → .edge('setup', 'process.step1') runs parent setup before child step1
   *    → .edge('process.done', 'aggregate') runs parent aggregate after child done */
  subgraph(name: string, childDef: WorkflowDefinition): this
  /** Build the workflow definition */
  build(): WorkflowDefinition
}

export function workflow(
  name: string,
  config: {
    state: Record<string, unknown>
    version?: string
    description?: string
    author?: string
    repository?: string
    license?: string
  },
): WorkflowBuilder {
  const state: WorkflowBuilderState = {
    name,
    stateSchema: config.state as Record<string, unknown>,
    nodes: [],
    edges: [],
    entryNodes: [],
    exitNodes: [],
    version: config.version,
    description: config.description,
    author: config.author,
    repository: config.repository,
    license: config.license,
  }

  const builder: WorkflowBuilder = {
    add(nodeName: string, node: NodeBuilder) {
      state.nodes.push({ name: nodeName, builder: node._state })
      return builder
    },

    edge(from: NodeRef, to: NodeRef) {
      if (typeof from === 'string' && typeof to === 'string') {
        state.edges.push({ from, to })
      } else if (from === START && typeof to === 'string') {
        state.entryNodes.push(to)
      } else if (to === END && typeof from === 'string') {
        state.exitNodes.push(from)
      }
      return builder
    },

    condEdge(from: string, targets: string[], fn: RouteFn) {
      state.edges.push({
        from,
        targets,
        fn,
      })
      return builder
    },

    subgraph(wfName: string, childDef: WorkflowDefinition) {
      // Add prefixed child nodes to the node list
      for (const childNode of childDef.nodes) {
        state.nodes.push({
          name: `${wfName}.${childNode.name}`,
          builder: { fn: childNode.fn },
        })
      }

      // Add remapped child edges (plain and conditional unified)
      for (const edge of childDef.edges) {
        if (isPlainEdge(edge)) {
          state.edges.push({
            from: `${wfName}.${edge.from}`,
            to: `${wfName}.${edge.to}`,
          })
        } else {
          state.edges.push({
            from: `${wfName}.${edge.from}`,
            targets: edge.targets.map((t) => `${wfName}.${t}`),
            fn: edge.fn,
          })
        }
      }

      return builder
    },

    build(): WorkflowDefinition {
      return {
        name: state.name,
        stateSchema: state.stateSchema,
        nodes: state.nodes.map((n) => ({
          name: n.name,
          fn: n.builder.fn,
        })),
        edges: state.edges,
        version: state.version,
        description: state.description,
        author: state.author,
        repository: state.repository,
        license: state.license,
      }
    },
  }

  return builder
}
