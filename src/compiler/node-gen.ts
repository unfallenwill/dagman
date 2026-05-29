import type { Node } from '../shared/models/node.js'
import type { Edge } from '../shared/models/graph.js'
import type {
  NodeDef,
  CondEdgeDef,
  FanOutDef,
  WorkflowDefinition,
} from '../shared/models/workflow-def.js'

interface ExpandedResult {
  allNodes: Node[]
  allEdges: Edge[]
}

/**
 * Expand the workflow definition into full node/edge lists.
 * 1. Convert NodeDef → Node for user-defined nodes
 * 2. For nodes with stateKey → generate collect-<name> virtual node + internal edges
 * 3. Rewire downstream edges to depend on collect nodes
 * 4. For condEdges → generate cond:* virtual node + edges
 */
export function expandWorkflow(definition: WorkflowDefinition): ExpandedResult {
  // Step 1: Convert user nodes and generate collect nodes
  const { nodes, collectEdges } = expandCollectNodes(definition)

  // Step 2: Expand condEdges into virtual nodes + edges
  const { condNodes, condEdges } = expandCondEdges(definition.condEdges)

  // Step 3: Expand fanOuts into virtual nodes + edges
  const { fanoutNodes, fanoutEdges } = expandFanOutNodes(definition.fanOuts)

  // Step 4: Merge ALL edges, then rewire for collect nodes
  // Important: condEdge/fanout edges that point to a node with stateKey
  // must be rewired to depend on the collect node instead.
  const allEdgesBeforeRewire = [...definition.edges, ...collectEdges, ...condEdges, ...fanoutEdges]
  const allEdges = rewireEdgesForCollect(allEdgesBeforeRewire, definition.nodes)

  return {
    allNodes: [...nodes, ...condNodes, ...fanoutNodes],
    allEdges,
  }
}

/** Convert NodeDef[] to Node[], generate collect virtual nodes */
function expandCollectNodes(definition: WorkflowDefinition) {
  const nodes: Node[] = []
  const collectEdges: Edge[] = []

  for (const nodeDef of definition.nodes) {
    // User node
    nodes.push({
      name: nodeDef.name,
      kind: 'user',
      stateKey: nodeDef.stateKey,
    })

    // Generate collect node if stateKey is set
    if (nodeDef.stateKey) {
      const collectName = `collect-${nodeDef.name}`
      nodes.push({
        name: collectName,
        kind: 'collect',
        parentNodeId: nodeDef.name,
        stateKey: nodeDef.stateKey,
      })

      // Internal edge: collect-A depends on A
      collectEdges.push({ from: collectName, to: nodeDef.name })
    }
  }

  return { nodes, collectEdges }
}

/** Rewire edges: if a downstream node has a collect node, point to collect instead */
function rewireEdgesForCollect(edges: Edge[], nodeDefs: NodeDef[]): Edge[] {
  // Build set of nodes that have collect tasks
  const nodesWithCollect = new Set(nodeDefs.filter((n) => n.stateKey).map((n) => n.name))

  return edges.map((edge) => {
    // If the `to` node has a collect task, rewire to collect-<to>
    if (nodesWithCollect.has(edge.to)) {
      const collectName = `collect-${edge.to}`
      // Don't rewire if this is already a collect internal edge
      if (!edge.from.startsWith('collect-')) {
        return { ...edge, to: collectName }
      }
    }
    return edge
  })
}

/** Expand condEdges into virtual routing nodes + edges */
function expandCondEdges(condEdgeDefs: CondEdgeDef[]) {
  const condNodes: Node[] = []
  const condEdges: Edge[] = []

  for (const condDef of condEdgeDefs) {
    // Virtual routing node
    condNodes.push({
      name: condDef.nodeName,
      kind: 'cond',
      targets: condDef.targets,
    })

    // condEdge depends on upstream node (or its collect node)
    // The from might have a collect node; the rewiring will handle this
    condEdges.push({ from: condDef.nodeName, to: condDef.from })

    // Each candidate target depends on the condEdge
    for (const target of condDef.targets) {
      condEdges.push({ from: target, to: condDef.nodeName })
    }
  }

  return { condNodes, condEdges }
}

/** Expand fanOuts into virtual nodes + edges */
function expandFanOutNodes(fanOutDefs: FanOutDef[]): { fanoutNodes: Node[]; fanoutEdges: Edge[] } {
  const fanoutNodes: Node[] = []
  const fanoutEdges: Edge[] = []

  for (const fanDef of fanOutDefs) {
    // Virtual fan-out node
    fanoutNodes.push({
      name: fanDef.nodeName,
      kind: 'fanout',
      templateNode: fanDef.templateNode,
    })

    // fanout depends on upstream node (or its collect node — rewiring handles this)
    fanoutEdges.push({ from: fanDef.nodeName, to: fanDef.from })

    // template node depends on fanout
    fanoutEdges.push({ from: fanDef.templateNode, to: fanDef.nodeName })
  }

  return { fanoutNodes, fanoutEdges }
}
