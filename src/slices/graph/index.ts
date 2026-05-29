import type { Command } from 'commander'
import { compileWorkflow } from '../../domain/compiler/compiler.js'
import { computeTopologicalLayers } from '../../shared/utils/topology.js'
import { withErrorHandler, outputJson } from '../_shared/output.js'

/** Format node name with kind prefix/color hint */
function formatNodeLabel(name: string, kind?: string): string {
  if (!kind || kind === 'user') {
    return `[${name}]`
  }

  // Virtual nodes: collect, cond, fanout
  if (kind === 'collect') {
    return `[collect:${name.replace('collect-', '')}]`
  }
  if (kind === 'cond') {
    return `[cond:${name}]`
  }
  if (kind === 'fanout') {
    return `[fanout:${name}]`
  }

  return `[${name}]`
}

/** Render ASCII layered topology */
function renderAsciiLayers(
  layers: Map<number, string[]>,
  nodes: Array<{ name: string; kind?: string }>,
): void {
  const nodeKindMap = new Map(nodes.map((n) => [n.name, n.kind]))

  for (const [layerIdx, nodeNames] of layers.entries()) {
    const formattedNodes = nodeNames.map((name) => {
      const kind = nodeKindMap.get(name)
      const label = formatNodeLabel(name, kind)
      return label
    })

    console.log(`Layer ${layerIdx} │ ${formattedNodes.join('  ')}`)
  }
}

export function registerGraphCommand(program: Command): void {
  program
    .command('graph <name>')
    .summary('Display layered topology of a workflow')
    .option('--json', 'Output as JSON')
    .action(
      withErrorHandler(async (name: string, opts: { json?: boolean }) => {
        const result = await compileWorkflow(name)
        const layers = computeTopologicalLayers(
          result.graph.edges,
          result.nodes.map((n) => n.name),
        )

        if (opts.json) {
          outputJson({
            workflow: name,
            layers: Object.fromEntries(layers),
            nodes: result.nodes.map((n) => ({
              name: n.name,
              kind: n.kind,
              layer: (() => {
                for (const [idx, names] of layers.entries()) {
                  if (names.includes(n.name)) return idx
                }
                return -1
              })(),
            })),
          })
        } else {
          renderAsciiLayers(layers, result.nodes)
        }
      }),
    )
}
