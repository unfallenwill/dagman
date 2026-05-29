import type { Edge } from '../shared/models/graph.js'
import type { WorkflowDefinition } from '../shared/models/workflow-def.js'
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
   *  `fn` is evaluated to determine which target executes. */
  condEdge(from: string, to: string[], fn: (state: any) => string): this
  /** Add a fan-out edge — dynamic parallel task generation.
   *  `from` triggers the fan-out, `templateNode` is the node to instantiate,
   *  `fn` returns an array of items, each creating one task instance. */
  fanOut(from: string, templateNode: string, fn: (state: any) => any[]): this
  /** Embed a child workflow as a subgraph.
   *  Child nodes are prefixed with `name.`, edges are remapped.
   *  Example: .subgraph('process', childDef)
   *    → child node 'step1' becomes 'process.step1'
   *    → Use .edge('process.step1', 'setup') to connect to parent */
  subgraph(name: string, childDef: WorkflowDefinition): this
  /** Build the workflow definition */
  build(): WorkflowDefinition
}

export function workflow(
  name: string,
  config: { state: Record<string, unknown> },
): WorkflowBuilder {
  const state: WorkflowBuilderState = {
    name,
    // Store the Zod schema as-is; the caller serializes to JSON Schema externally
    // or we treat the zod object as a record for now.
    stateSchema: config.state as Record<string, unknown>,
    nodes: [],
    edges: [],
    condEdges: [],
    fanOuts: [],
    entryNodes: [],
    exitNodes: [],
  }

  const builder: WorkflowBuilder = {
    add(nodeName: string, node: NodeBuilder) {
      state.nodes.push({ name: nodeName, builder: node._state })
      return builder
    },

    edge(from: NodeRef, to: NodeRef) {
      if (typeof from === 'string' && typeof to === 'string') {
        state.edges.push({ from, to } as Edge)
      } else if (from === START && typeof to === 'string') {
        state.entryNodes.push(to)
      } else if (to === END && typeof from === 'string') {
        state.exitNodes.push(from)
      }
      return builder
    },

    condEdge(from: string, targets: string[], fn: (state: any) => string) {
      const nodeName = `cond:${from}→route`
      state.condEdges.push({
        nodeName,
        from,
        targets,
        fn,
      })
      return builder
    },

    fanOut(from: string, templateNode: string, fn: (state: any) => any[]) {
      const nodeName = `fanout:${from}→${templateNode}`
      state.fanOuts.push({
        nodeName,
        from,
        templateNode,
        fn,
      })
      return builder
    },

    subgraph(wfName: string, childDef: WorkflowDefinition) {
      // Add prefixed child nodes to the node list
      for (const childNode of childDef.nodes) {
        state.nodes.push({
          name: `${wfName}.${childNode.name}`,
          builder: { fn: childNode.fn, stateKey: childNode.stateKey },
        })
      }

      // Add remapped child edges
      for (const edge of childDef.edges) {
        state.edges.push({
          from: `${wfName}.${edge.from}`,
          to: `${wfName}.${edge.to}`,
        })
      }

      // Add remapped condEdges
      for (const condEdge of childDef.condEdges) {
        state.condEdges.push({
          nodeName: `${wfName}.${condEdge.nodeName}`,
          from: `${wfName}.${condEdge.from}`,
          targets: condEdge.targets.map((t) => `${wfName}.${t}`),
          fn: condEdge.fn,
        })
      }

      // Add remapped fanOuts
      for (const fanOut of childDef.fanOuts) {
        state.fanOuts.push({
          nodeName: `${wfName}.${fanOut.nodeName}`,
          from: `${wfName}.${fanOut.from}`,
          templateNode: `${wfName}.${fanOut.templateNode}`,
          fn: fanOut.fn,
        })
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
          stateKey: n.builder.stateKey,
        })),
        edges: state.edges,
        condEdges: state.condEdges,
        fanOuts: state.fanOuts,
        entryNodes: state.entryNodes,
        exitNodes: state.exitNodes,
      }
    },
  }

  return builder
}
