import type { Command } from 'commander'
import { compile } from '../../domain/compiler/compiler.js'
import { resolveDiscoveryDeps } from '../../domain/workflow/workflow-discovery.js'
import { renderWorkflowGraph } from '../../domain/visualization/render.js'
import { createTheme } from '../../domain/visualization/color.js'
import { setCommandMeta } from '../_shared/command-meta.js'
import { withErrorHandler, outputJson } from '../_shared/output.js'

export function registerShowCommand(program: Command): void {
  const showCmd = program.command('show <name>').summary('Show workflow information')
    .description(`Display workflow metadata and ASCII graph visualization.

Shows name, version, description, author, repository, and license
for the named workflow. Also renders an ASCII DAG visualization of
the workflow graph, including nodes, edges, and topological layers.

Use --json for machine-readable output.`)

  setCommandMeta(showCmd, {
    examples: [
      { description: 'Show workflow details', command: 'dagman show my-workflow' },
      { description: 'Show as JSON', command: 'dagman show my-workflow --json' },
    ],
    exitStatus: [
      { code: 0, meaning: 'Success (workflow info displayed)' },
      { code: 1, meaning: 'Error (workflow not found)' },
    ],
    seeAlso: ['dagman-ls(1)', 'dagman-start(1)'],
    dataProducing: true,
  })

  showCmd.option('--json', 'Output as JSON').action(
    withErrorHandler(async (name: string, opts: { json?: boolean }) => {
      const { loader, getWorkflowTsFile } = resolveDiscoveryDeps()
      const tsFile = getWorkflowTsFile(name)
      const definition = await loader.load(tsFile)

      const info = {
        name: definition.name,
        version: definition.version ?? '0.0.0',
        description: definition.description ?? '',
        author: definition.author,
        repository: definition.repository,
        license: definition.license,
      }

      if (opts.json) {
        outputJson(info)
      } else {
        console.log('Name:       ' + info.name)
        console.log('Version:    ' + info.version)
        console.log('Description:' + info.description)
        if (info.author) console.log('Author:     ' + info.author)
        if (info.repository) console.log('Repository: ' + info.repository)
        if (info.license) console.log('License:    ' + info.license)

        // Render ASCII DAG graph
        const compiledGraph = await compile(name)
        try {
          const theme = createTheme(process.stdout.isTTY)
          const lines = renderWorkflowGraph(definition, compiledGraph, theme)
          if (lines.length > 0) {
            console.log()
            for (const line of lines) {
              console.log(line)
            }
          }
        } catch (err: unknown) {
          // Rendering failure is non-fatal — metadata already shown
          console.log()
          console.log(`Warning: could not render graph: ${(err as Error).message}`)
        }
      }
    }),
  )
}
