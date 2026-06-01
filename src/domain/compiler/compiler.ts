import type {
  ChannelWriteStrategy,
  CompiledGraph,
  CompiledNode,
  Edge,
  RouteFn,
  WorkflowDefinition,
} from '../../shared/models/compiled-graph.js'
import { isPlainEdge, isConditionalEdge } from '../../shared/models/compiled-graph.js'
import type { WorkflowLoader } from '../../shared/utils/loader.js'
import { generateChannels } from './channel-gen.js'
import { validateWorkflow } from './validator.js'
import { ValidationError } from '../../shared/errors.js'
import { match } from 'ts-pattern'
import * as R from 'remeda'

// ── DI Pattern ──────────────────────────────────────────────────────

export interface CompilerDeps {
  loader?: WorkflowLoader
  getWorkflowTsFile?: (name: string) => string
}

let _defaults: Partial<CompilerDeps> = {}

/** Set default deps — called by engine/composition root at startup */
export function setDefaultCompilerDeps(defaults: Partial<CompilerDeps>): void {
  _defaults = { ..._defaults, ...defaults }
}

function resolveCompilerDeps(deps?: CompilerDeps) {
  const merged = { ..._defaults, ...deps }
  return {
    loader: merged.loader!,
    getWorkflowTsFile: merged.getWorkflowTsFile!,
  }
}

// ── Compiler (compiled-graph architecture) ──────────────────────────

/**
 * Compile a TypeScript workflow into a CompiledGraph using the channel architecture.
 *
 * Steps:
 * 1. Load the TS workflow file via the loader (returns WorkflowDefinition)
 * 2. Validate: node names, edge references, state schema, no cycles
 * 3. Generate channels and node strategies from unified edges
 * 4. Build CompiledNode for each node
 * 5. Compute topological layers via BFS
 * 6. Return CompiledGraph
 */
export async function compile(workflowName: string, deps?: CompilerDeps): Promise<CompiledGraph> {
  const d = resolveCompilerDeps(deps)
  const tsFile = d.getWorkflowTsFile(workflowName)

  // ── 1. Load (returns WorkflowDefinition) ──
  const definition = await d.loader.load(tsFile)

  // ── 2. Validate (returns Result — handle with neverthrow) ──
  const validationResult = validateWorkflow(definition)
  if (validationResult.isErr()) {
    throw validationResult.error
  }

  // ── 3. Generate channels from unified Edge[] ──
  const nodeIds = R.pipe(
    definition.nodes,
    R.map((n) => n.name),
  )
  const { channels, nodeStrategies, nodeTriggeredBy, routeTargets } = generateChannels(
    nodeIds,
    definition.edges,
  )

  // ── 4. Build compiled nodes ──
  const nodes = buildCompiledNodes(definition, nodeStrategies, nodeTriggeredBy, routeTargets)

  // ── 5. Compute topological layers ──
  const layers = computeLayers(definition.edges, nodeIds)

  // ── 6. Return ──
  return {
    name: workflowName,
    nodes,
    stateSchema: definition.stateSchema,
    channels,
    layers,
    version: definition.version,
    description: definition.description,
  }
}

/**
 * Build the compiled node map from definition + generated channel strategies.
 */
function buildCompiledNodes(
  definition: WorkflowDefinition,
  nodeStrategies: Record<string, ChannelWriteStrategy[]>,
  nodeTriggeredBy: Record<string, string>,
  routeTargets: Record<string, { fn: RouteFn; targets: string[] }>,
): Record<string, CompiledNode> {
  const entries = R.pipe(
    definition.nodes,
    R.map((nodeDef) => {
      const routeInfo = routeTargets[nodeDef.name]
      const compiledNode: CompiledNode = {
        id: nodeDef.name,
        fn: nodeDef.fn,
        strategies: nodeStrategies[nodeDef.name] ?? [],
        triggeredBy: nodeTriggeredBy[nodeDef.name]!,
        ...(routeInfo
          ? {
              route: routeInfo.fn,
              routeTargets: routeInfo.targets,
            }
          : {}),
      }
      return [nodeDef.name, compiledNode] as const
    }),
  )
  return Object.fromEntries(entries) as Record<string, CompiledNode>
}

/**
 * Compute topological layers using BFS (Kahn's algorithm).
 *
 * Edge direction: `from` depends on `to` (from is triggered by to),
 * so in the dependency graph: from has in-degree from `to`.
 * Entry nodes (no incoming edges = no triggers) go in layer 0.
 *
 * Handles the unified Edge[] using ts-pattern to dispatch PlainEdge / ConditionalEdge.
 */
function computeLayers(edges: Edge[], nodeIds: string[]): string[][] {
  if (nodeIds.length === 0) return []

  // Build in-degree and reverse adjacency
  // Edge direction: { from, to } means from triggers to (flow direction)
  // So to depends on from → from executes before to
  // In-degree of `to` increases for each edge(from, to)
  const inDegree = new Map<string, number>()
  for (const name of nodeIds) {
    inDegree.set(name, 0)
  }

  const dependents = new Map<string, string[]>() // source → [targets that depend on it]

  function addDependency(target: string, source: string): void {
    if (!inDegree.has(target)) return
    inDegree.set(target, inDegree.get(target)! + 1)
    const list = dependents.get(source) ?? []
    list.push(target)
    dependents.set(source, list)
  }

  // Process unified Edge[] — dispatch via ts-pattern
  for (const edge of edges) {
    match(edge)
      .when(isPlainEdge, (e) => {
        // PlainEdge { from, to }: from triggers to → to depends on from → to executes after from
        addDependency(e.to, e.from)
      })
      .when(isConditionalEdge, (e) => {
        // ConditionalEdge: targets depend on from → target=each target, source=from
        for (const target of e.targets) {
          addDependency(target, e.from)
        }
      })
      .exhaustive()
  }

  // BFS layering
  const layers: string[][] = []
  const assigned = new Set<string>()
  let currentLayer = [...inDegree.entries()].filter(([, deg]) => deg === 0).map(([name]) => name)

  while (currentLayer.length > 0) {
    layers.push(currentLayer)
    for (const name of currentLayer) {
      assigned.add(name)
    }

    const nextLayer: string[] = []
    for (const name of currentLayer) {
      for (const dep of dependents.get(name) ?? []) {
        if (assigned.has(dep)) continue
        const newDeg = inDegree.get(dep)! - 1
        inDegree.set(dep, newDeg)
        if (newDeg === 0 && !assigned.has(dep)) {
          nextLayer.push(dep)
        }
      }
    }

    currentLayer = nextLayer
  }

  // Safety check: if not all nodes are assigned, there is a cycle
  if (assigned.size !== nodeIds.length) {
    const unassigned = nodeIds.filter((n) => !assigned.has(n))
    throw new ValidationError(
      `workflow contains a cycle (unassigned nodes: ${unassigned.join(', ')})`,
    )
  }

  return layers
}
