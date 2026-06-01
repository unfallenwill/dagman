import type { Edge, WorkflowDefinition } from '../../shared/models/compiled-graph.js'
import { isConditionalEdge, isPlainEdge } from '../../shared/models/compiled-graph.js'
import { ValidationError } from '../../shared/errors.js'
import type { Result } from 'neverthrow'
import { err, ok } from 'neverthrow'
import { match } from 'ts-pattern'
import * as R from 'remeda'

/**
 * Validate a WorkflowDefinition before compilation.
 *
 * Checks:
 * 1. State schema exists and is non-empty
 * 2. At least one node exists
 * 3. No duplicate node names
 * 4. All node names referenced in edges exist (PlainEdge + ConditionalEdge unified)
 * 5. ConditionalEdge targets must not be empty
 * 6. No cycles in the combined edge graph
 * 7. All nodes reachable from entry nodes (no orphan or disconnected nodes)
 */
export function validateWorkflow(def: WorkflowDefinition): Result<void, ValidationError> {
  const errors: string[] = []

  // ── 1. State schema ──
  if (Object.keys(def.stateSchema).length === 0) {
    errors.push('workflow must define a non-empty state schema via workflow().state()')
  }

  // ── 2. At least one node ──
  if (def.nodes.length === 0) {
    errors.push('workflow must define at least one node')
  }

  if (errors.length > 0) {
    return err(new ValidationError('workflow validation failed', errors))
  }

  // ── 3. No duplicate node names ──
  const nodeNames = R.pipe(
    def.nodes,
    R.map((n) => n.name),
  )
  const uniqNames = R.unique(nodeNames)
  if (uniqNames.length !== nodeNames.length) {
    const duplicates = R.pipe(
      nodeNames,
      R.filter((name: string) => nodeNames.indexOf(name) !== nodeNames.lastIndexOf(name)),
      R.unique(),
    )
    errors.push(`duplicate node names: ${duplicates.map((n) => `'${n}'`).join(', ')}`)
  }

  const nodeNameSet = new Set(uniqNames)

  // ── 4 & 5. Edge references (unified PlainEdge + ConditionalEdge) ──
  const edgeErrors = validateEdgeReferences(def.edges, nodeNameSet)
  errors.push(...edgeErrors)

  if (errors.length > 0) {
    return err(new ValidationError('workflow validation failed', errors))
  }

  // ── 6. Cycle detection ──
  const cycleError = detectCycles(def.edges)
  if (cycleError) {
    return err(new ValidationError(cycleError))
  }

  // ── 7. Reachability check (orphan / unreachable nodes) ──
  const reachabilityError = detectUnreachableNodes(def.edges, nodeNameSet)
  if (reachabilityError) {
    return err(new ValidationError(reachabilityError))
  }

  return ok(undefined)
}

/**
 * Validate that all node names referenced in edges exist in the node set.
 * Handles both PlainEdge and ConditionalEdge via type guards + ts-pattern.
 */
function validateEdgeReferences(edges: Edge[], nodeNames: Set<string>): string[] {
  const errors: string[] = []

  edges.forEach((edge, i) => {
    match(edge)
      .when(isPlainEdge, (e) => {
        if (!nodeNames.has(e.from)) {
          errors.push(`edge[${i}] references unknown source node '${e.from}'`)
        }
        if (!nodeNames.has(e.to)) {
          errors.push(`edge[${i}] references unknown target node '${e.to}'`)
        }
      })
      .when(isConditionalEdge, (e) => {
        if (!nodeNames.has(e.from)) {
          errors.push(`edge[${i}] references unknown source node '${e.from}'`)
        }
        for (const target of e.targets) {
          if (!nodeNames.has(target)) {
            errors.push(`edge[${i}] references unknown target node '${target}'`)
          }
        }
        if (e.targets.length === 0) {
          errors.push(`edge[${i}] from '${e.from}' has no targets`)
        }
      })
      .exhaustive()
  })

  return errors
}

/**
 * Build forward adjacency map from unified Edge[].
 * Direction: from -> [to, ...] represents data flow (upstream -> downstream).
 */
function buildForwardAdjacency(edges: Edge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>()

  function add(from: string, to: string): void {
    const targets = adj.get(from) ?? []
    targets.push(to)
    adj.set(from, targets)
  }

  for (const edge of edges) {
    match(edge)
      .when(isPlainEdge, (e) => {
        add(e.from, e.to)
      })
      .when(isConditionalEdge, (e) => {
        for (const target of e.targets) {
          add(e.from, target)
        }
      })
      .exhaustive()
  }

  return adj
}

/**
 * Detect cycles in the unified edge graph.
 * Uses DFS three-color marking.
 *
 * For cycle detection, conditional edges are expanded: from -> each target
 * creates a directed edge from the source to the target (dependency direction).
 */
function detectCycles(edges: Edge[]): string | null {
  const adj = buildForwardAdjacency(edges)

  // Collect all nodes referenced in edges
  const allNodes = new Set<string>()
  for (const [from, targets] of adj) {
    allNodes.add(from)
    for (const t of targets) {
      allNodes.add(t)
    }
  }

  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  for (const node of allNodes) {
    color.set(node, WHITE)
  }

  function dfs(node: string): boolean {
    color.set(node, GRAY)
    const targets = adj.get(node) ?? []
    for (const target of targets) {
      const c = color.get(target)
      if (c === GRAY) return true
      if (c === WHITE && dfs(target)) return true
    }
    color.set(node, BLACK)
    return false
  }

  for (const node of allNodes) {
    if (color.get(node) === WHITE) {
      if (dfs(node)) {
        return 'workflow contains a cycle in its edge definitions'
      }
    }
  }

  return null
}

/**
 * Detect orphan nodes (not connected to any edge).
 *
 * In a valid DAG where all nodes appear in edges, forward BFS from entry
 * nodes (in-degree 0) always reaches every node. So the only unreachable
 * case is orphan nodes — nodes that do not appear in any edge.
 *
 * Special case: a single-node workflow with no edges is valid
 * (the node is the sole entry node and trivially reachable).
 */
function detectUnreachableNodes(edges: Edge[], nodeNames: Set<string>): string | null {
  // Single-node workflow: the node is the start, no edges needed
  if (nodeNames.size <= 1 && edges.length === 0) return null

  // Build connected set: nodes that appear in at least one edge
  const connectedNodes = new Set<string>()
  for (const edge of edges) {
    match(edge)
      .when(isPlainEdge, (e) => {
        connectedNodes.add(e.from)
        connectedNodes.add(e.to)
      })
      .when(isConditionalEdge, (e) => {
        connectedNodes.add(e.from)
        for (const t of e.targets) connectedNodes.add(t)
      })
      .exhaustive()
  }

  // Orphan detection: nodes with no edges at all
  const orphans = [...nodeNames].filter((name) => !connectedNodes.has(name)).sort()
  if (orphans.length > 0) {
    return `orphan node${orphans.length > 1 ? 's' : ''} with no edges: ${orphans.map((n) => `'${n}'`).join(', ')}`
  }

  return null
}
