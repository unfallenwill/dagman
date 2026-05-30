import type { Command } from 'commander'
import { listWorkflows } from '../../domain/workflow/workflow-discovery.js'
import { withErrorHandler } from '../_shared/output.js'

export function registerLsCommand(program: Command): void {
  program
    .command('ls')
    .summary('List discovered workflows')
    .action(
      withErrorHandler(async () => {
        const workflows = await listWorkflows()
        if (workflows.length === 0) {
          console.log('No workflows found in .dagman/workflows/')
          return
        }
        for (const wf of workflows) {
          console.log('  ' + wf.name + ' v' + wf.version + ' - ' + wf.description)
        }
      }),
    )
}
