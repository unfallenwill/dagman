import type { Command } from 'commander'
import * as runService from '../domain/run/run-service.js'
import { withErrorHandler, outputJson } from '../slices/_shared/output.js'

/** Render process status table */
function renderPsTable(
  runs: Array<{
    id: string
    status: string
    graphName?: string
    createdAt: string
  }>,
): void {
  if (runs.length === 0) {
    console.log('No workflow instances found.')
    return
  }

  for (const run of runs) {
    const progress = run.graphName ? '' : '' // Could add task progress later
    const date = new Date(run.createdAt).toLocaleString()
    console.log(`  ${run.id}  ${run.status}  ${progress}  ${date}`)
  }
}

export function registerPsCommand(program: Command): void {
  program
    .command('ps')
    .summary('List workflow instances')
    .option('-a, --all', 'Show all instances (not just running)')
    .option('--json', 'Output as JSON')
    .action(
      withErrorHandler(async (opts: { all?: boolean; json?: boolean }) => {
        const runs = await runService.listRuns()
        const filtered = opts.all ? runs : runs.filter((r) => r.status === 'running')

        if (opts.json) {
          outputJson(
            filtered.map((r) => ({
              id: r.id,
              status: r.status,
              graphName: r.graphName,
              createdAt: r.createdAt,
            })),
          )
        } else {
          renderPsTable(filtered)
        }
      }),
    )
}
