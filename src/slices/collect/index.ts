import type { Command } from 'commander'
import * as fs from 'fs/promises'
import * as path from 'path'
import { withErrorHandler, outputJson } from '../_shared/output.js'
import { setCommandMeta } from '../_shared/command-meta.js'
import { completeNodeExternal } from '../../domain/engine/execution-engine.js'
import { readState } from '../../domain/engine/state-service.js'
import { listRunIds } from '../../domain/run/run-resolver.js'
import { ValidationError } from '../../shared/errors.js'
import { parseNodeRef } from '../../shared/utils/id.js'

export function registerCollectCommand(program: Command): void {
  const collectCmd = program.command('collect').summary('Collect results for a workflow node')
    .description(`Submit external results for a node in the current run.

This command is used to provide results for nodes that wait for external
input (e.g. user confirmation, agent response). It writes the value to
the shared state, marks the node's task as completed, and writes the
node's held channels so downstream nodes can trigger.

Usage: dagman collect <node-ref> -f <result.json>
       dagman collect <node-ref> --value '{"key":"value"}'`)

  setCommandMeta(collectCmd, {
    examples: [
      {
        description: 'Collect result from a JSON file',
        command: 'dagman collect mynode@abc123 -f result.json',
      },
      {
        description: 'Collect result with inline value',
        command: 'dagman collect mynode@abc123 --value \'{"intent":"done"}\'',
      },
      {
        description: 'Collect with explicit state key',
        command: 'dagman collect mynode@abc123 --value true --key myResult',
      },
    ],
    exitStatus: [
      { code: 0, meaning: 'Success (result collected and task completed)' },
      { code: 1, meaning: 'Error (validation failed, task not found, etc.)' },
    ],
    seeAlso: ['dagman-next(1)', 'dagman-start(1)'],
    dataProducing: true,
  })

  collectCmd
    .argument('<node-ref>', 'node reference in format <node-name@instance-suffix>')
    .option('-f, --file <path>', 'JSON file containing the result')
    .option('--value <json>', 'inline JSON value for the result')
    .option('--key <stateKey>', 'state key to write the value to (defaults to node name)')
    .option('--json', 'output result as JSON')
    .action(
      withErrorHandler(
        async (
          nodeRef: string,
          options: {
            file?: string
            value?: string
            key?: string
            json?: boolean
          },
        ) => {
          // Parse node reference: <node-name>@<instance-suffix>
          const { nodeName, instanceSuffix } = parseNodeRef(nodeRef)

          // Resolve run ID from instance suffix
          const runIds = await listRunIds()
          const rid = runIds.find((id) => id.endsWith(`@${instanceSuffix}`))
          if (!rid) {
            throw new ValidationError(
              `no workflow instance found matching suffix @${instanceSuffix}`,
            )
          }

          // Determine the state key (defaults to node name)
          const stateKey = options.key ?? nodeName

          // Read result value
          let resultValue: unknown
          if (options.file) {
            const absPath = path.resolve(options.file)
            const content = await fs.readFile(absPath, 'utf-8')
            resultValue = JSON.parse(content)
          } else if (options.value) {
            resultValue = JSON.parse(options.value)
          } else {
            throw new ValidationError('must provide --file <path> or --value <json>')
          }

          // Complete the node externally: patch state + write channels + mark task success
          await completeNodeExternal(rid, nodeName, { [stateKey]: resultValue })

          // Read updated state for display
          const state = await readState(rid)

          if (options.json) {
            outputJson({
              nodeName,
              runId: rid,
              stateKey,
              value: resultValue,
              status: 'success',
              state,
            })
          } else {
            console.log(`Collected '${stateKey}' for ${nodeName} (${rid})`)
            console.log(`  Value: ${JSON.stringify(resultValue)}`)
            console.log(`  Task: ${nodeName} → success`)
          }
        },
      ),
    )
}
