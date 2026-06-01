/**
 * Render orchestrator — high-level API consumed by the CLI slice.
 *
 * Composes visual-graph building and ASCII rendering into a single
 * call that produces lines ready for console.log.
 */

import type { ColorTheme } from './color.js'
import { renderGraph } from './ascii-renderer.js'
import { buildVisualGraph } from './visual-graph.js'
import type { CompiledGraph, WorkflowDefinition } from '../../shared/models/compiled-graph.js'

/**
 * Build and render a visual graph from definition + compiled output.
 * Returns an array of colored ASCII lines.
 */
export function renderWorkflowGraph(
  definition: WorkflowDefinition,
  graph: CompiledGraph,
  theme: ColorTheme,
): string[] {
  const visualGraph = buildVisualGraph(definition, graph)
  return renderGraph(visualGraph, theme)
}
