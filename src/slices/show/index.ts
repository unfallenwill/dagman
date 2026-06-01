import type { Command } from 'commander'
import { resolveDiscoveryDeps } from '../../domain/workflow/workflow-discovery.js'
import { withErrorHandler, outputJson } from '../_shared/output.js'

export function registerShowCommand(program: Command): void {
  program
    .command('show <name>')
    .summary('Show workflow information')
    .option('--json', 'Output as JSON')
    .action(
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
        }
      }),
    )
}
