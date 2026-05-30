import * as path from 'path'
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
  getWorkflowManifest?: (name: string) => string
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
    getWorkflowManifest: merged.getWorkflowManifest!,
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
 * Compile a TS workflow: load manifest → tsx import → expand → validate.
 */
export async function compileWorkflow(
  workflowName: string,
  deps?: CompilerDeps,
): Promise<CompileResult> {
  const d = resolveCompilerDeps(deps)
  const manifestFile = d.getWorkflowManifest(workflowName)

  // 1. Load manifest
  const manifest = await loadManifest(manifestFile)

  // 2. Validate definition name matches workflow name
  if (manifest.name !== workflowName) {
    throw new ValidationError(
      "workflow name mismatch: manifest has '" +
        manifest.name +
        "' but expected '" +
        workflowName +
        "'",
    )
  }

  // 3. Load and expand graph
  const graph = await loadWorkflowGraph(workflowName, deps)

  return { graph, nodes: graph.nodes ?? [], manifest }
}

/**
 * Load and validate manifest.yaml
 */
async function loadManifest(manifestFile: string): Promise<WorkflowManifest> {
  const fs = await import('fs/promises')
  const yaml = await import('js-yaml')

  let content: string
  try {
    content = await fs.readFile(path.resolve(manifestFile), 'utf-8')
  } catch {
    throw new ValidationError('manifest not found: ' + manifestFile)
  }

  const data = yaml.load(content) as Record<string, unknown>

  if (!data.name || typeof data.name !== 'string') {
    throw new ValidationError("manifest must have a 'name' field")
  }

  return {
    name: data.name,
    version: (data.version as string) || '0.0.0',
    description: (data.description as string) || '',
    author: data.author as string | undefined,
    repository: data.repository as string | undefined,
    license: data.license as string | undefined,
  }
}
