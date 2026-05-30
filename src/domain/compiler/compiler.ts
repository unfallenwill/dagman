import type { Graph } from '../../shared/models/graph.js'
import type { Node } from '../../shared/models/node.js'
import type { WorkflowManifest } from '../../shared/models/workflow-def.js'
import type { WorkflowLoader } from '../../shared/utils/loader.js'
import { hasCycle } from '../../shared/utils/topology.js'
import { ValidationError } from '../../shared/errors.js'
import { expandWorkflow } from './node-gen.js'

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

export interface CompileResult {
  graph: Graph
  nodes: Node[]
  manifest: WorkflowManifest
}

/**
 * Load and expand a TS workflow into a Graph (no manifest, no persistence).
 * Used by scheduler and collect commands that only need the graph structure.
 */
export async function loadWorkflowGraph(workflowName: string, deps?: CompilerDeps): Promise<Graph> {
  const d = resolveCompilerDeps(deps)
  const tsFile = d.getWorkflowTsFile(workflowName)

  const definition = await d.loader.load(tsFile)
  const { allNodes, allEdges } = expandWorkflow(definition)

  const graph: Graph = {
    name: workflowName,
    edges: allEdges,
    nodes: allNodes,
    stateSchema: definition.stateSchema,
    workflowName,
  }

  if (hasCycle(graph.edges)) {
    throw new ValidationError('compiled graph contains cycle dependency')
  }

  return graph
}

/**
 * Compile a TS workflow: tsx import → extract manifest → expand → validate.
 */
export async function compileWorkflow(
  workflowName: string,
  deps?: CompilerDeps,
): Promise<CompileResult> {
  const d = resolveCompilerDeps(deps)
  const tsFile = d.getWorkflowTsFile(workflowName)

  const definition = await d.loader.load(tsFile)
  const manifest = extractManifest(definition, workflowName)

  const { allNodes, allEdges } = expandWorkflow(definition)

  const graph: Graph = {
    name: workflowName,
    edges: allEdges,
    nodes: allNodes,
    stateSchema: definition.stateSchema,
    workflowName,
  }

  if (hasCycle(graph.edges)) {
    throw new ValidationError('compiled graph contains cycle dependency')
  }

  return { graph, nodes: graph.nodes ?? [], manifest }
}

/**
 * Extract WorkflowManifest from the loaded WorkflowDefinition.
 * Validates that the definition name matches the expected workflow name.
 */
function extractManifest(
  definition: { name?: string; version?: string; description?: string },
  workflowName: string,
): WorkflowManifest {
  if (!definition.name || typeof definition.name !== 'string') {
    throw new ValidationError("workflow definition must have a 'name' field")
  }

  if (definition.name !== workflowName) {
    throw new ValidationError(
      "workflow name mismatch: definition has '" +
        definition.name +
        "' but expected '" +
        workflowName +
        "'",
    )
  }

  return {
    name: definition.name,
    version: definition.version ?? '0.0.0',
    description: definition.description ?? '',
  }
}
