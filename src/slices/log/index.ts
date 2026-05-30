import type { Command } from 'commander'
import { resolveCurrentRunId, runExists } from '../../domain/run/run-service.js'
import { getEvents } from '../../domain/workflow/workflow-engine.js'
import { RunNotFoundError } from '../../shared/errors.js'
import { setCommandMeta } from '../_shared/command-meta.js'
import { withErrorHandler, outputJson } from '../_shared/output.js'

function formatEvent(iso: string, node: string, from: string, to: string): string {
  return `[${iso}] ${node}: ${from} -> ${to}`
}

export function registerLogCommand(program: Command): void {
  const logCmd = program.command('log [node]').summary('View execution log')
    .description(`View the fine-grained task event log for a run.

Shows all task state transitions with timestamps. Optionally filter
to events for a specific node.`)

  setCommandMeta(logCmd, {
    examples: [
      { description: 'View full execution log', command: 'dagman log' },
      { description: 'View log for a specific node', command: 'dagman log build' },
      { description: 'View log as JSON', command: 'dagman log --json' },
      { description: 'View log for a specific run', command: 'dagman log --run abc123' },
    ],
    exitStatus: [
      { code: 0, meaning: 'Success (even if no events exist)' },
      { code: 1, meaning: 'Run not found' },
    ],
    seeAlso: ['dagman-task-show(1)', 'dagman-step-history(1)'],
    dataProducing: true,
  })

  logCmd
    .option('--run <runId>', 'specify run')
    .option('--json', 'output in JSON format')
    .action(
      withErrorHandler(async (node?: string, options?: { run?: string; json?: boolean }) => {
        const runId = options?.run ?? (await resolveCurrentRunId())
        if (!(await runExists(runId))) {
          throw new RunNotFoundError(runId)
        }

        const events = await getEvents(runId)
        const filtered = node ? events.filter((e) => e.node === node) : events

        if (options?.json) {
          outputJson({ events: filtered })
          return
        }

        if (filtered.length === 0) {
          console.log(node ? `No execution log for node '${node}'` : 'No execution log')
          return
        }

        for (const e of filtered) {
          console.log(formatEvent(e.timestamp, e.node, e.from, e.to))
        }
      }),
    )
}
