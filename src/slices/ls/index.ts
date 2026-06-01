import type { Command } from 'commander'
import { listWorkflows } from '../../domain/workflow/workflow-discovery.js'
import { setCommandMeta } from '../_shared/command-meta.js'
import { withErrorHandler } from '../_shared/output.js'

export function registerLsCommand(program: Command): void {
  const lsCmd = program.command('ls').summary('List discovered workflows')
    .description(`List all discovered workflows from standard locations.

Searches .dagman/workflows/ and ~/.dagman/workflows/ for workflow
definitions. Shows name, version, source location, and description
for each discovered workflow.

Use --workflows-dir to search a custom directory instead.`)

  setCommandMeta(lsCmd, {
    examples: [
      { description: 'List all workflows', command: 'dagman ls' },
      {
        description: 'List workflows from a custom directory',
        command: 'dagman --workflows-dir ./my-flows ls',
      },
    ],
    exitStatus: [
      { code: 0, meaning: 'Success (list displayed, even if empty)' },
      { code: 1, meaning: 'Error (filesystem failure)' },
    ],
    seeAlso: ['dagman-show(1)', 'dagman-start(1)'],
    dataProducing: false,
  })

  lsCmd.action(
    withErrorHandler(async () => {
      const workflows = await listWorkflows()
      if (workflows.length === 0) {
        console.log('No workflows found in .dagman/workflows/ or ~/.dagman/workflows/')
        return
      }
      for (const wf of workflows) {
        console.log(`  [${wf.source}] ${wf.name} v${wf.version} - ${wf.description}`)
      }
    }),
  )
}
