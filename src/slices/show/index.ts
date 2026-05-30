import type { Command } from 'commander'
import { graphExists } from '../../domain/graph/graph-service.js'
import { loadManifest } from '../../domain/workflow/workflow-discovery.js'
import { withErrorHandler, outputJson } from '../_shared/output.js'

export function registerShowCommand(program: Command): void {
  program
    .command('show <name>')
    .summary('Show workflow information')
    .option('--json', 'Output as JSON')
    .action(
      withErrorHandler(async (name: string, opts: { json?: boolean }) => {
        const manifest = await loadManifest(name)
        const compiled = await graphExists(name)

        if (opts.json) {
          outputJson({ ...manifest, compiled })
        } else {
          console.log('Name:       ' + manifest.name)
          console.log('Version:    ' + manifest.version)
          console.log('Description:' + manifest.description)
          if (manifest.author) console.log('Author:     ' + manifest.author)
          if (manifest.repository) console.log('Repository: ' + manifest.repository)
          if (manifest.license) console.log('License:    ' + manifest.license)
          console.log('Compiled:   ' + (compiled ? 'yes' : 'no'))
        }
      }),
    )
}
