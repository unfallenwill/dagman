import type { Command } from 'commander'
import * as fs from 'fs/promises'
import * as path from 'path'
import { withErrorHandler, outputJson } from '../slices/_shared/output.js'
import { setCommandMeta } from '../slices/_shared/command-meta.js'
import * as runService from '../domain/run/run-service.js'
import * as graphService from '../domain/graph/graph-service.js'
import * as workflowService from '../domain/workflow/workflow-engine.js'
import { stateChannelName } from '../shared/models/channel.js'
import { ValidationError } from '../shared/errors.js'
import { parseNodeRef } from '../shared/utils/id.js'
import { listRunIds } from '../shared/utils/run-resolver.js'

export function registerCollectCommand(program: Command): void {
  const collectCmd = program.command('collect').summary('Collect results for a workflow node')
    .description(`Collect and validate results for a node that has a stateKey.

This command is used by the agent to submit results after a node
execution. It validates the result against the state schema, writes
the value to the appropriate state channel, and marks the collect
task as complete.

Usage: dagman collect <node-name@id-xxx> -f <result.json>`)

  setCommandMeta(collectCmd, {
    examples: [
      {
        description: 'Collect result from a JSON file',
        command: 'dagman collect classify@abc123 -f result.json',
      },
      {
        description: 'Collect result with inline value',
        command: 'dagman collect classify@abc123 --value \'{"intent":"need_tool\'}\'',
      },
    ],
    exitStatus: [
      { code: 0, meaning: 'Success (result collected and validated)' },
      { code: 1, meaning: 'Error (validation failed, task not found, etc.)' },
    ],
    seeAlso: ['dagman-next(1)', 'dagman-workflow(1)', 'dagman-channel(1)'],
    dataProducing: true,
  })

  collectCmd
    .argument('<node-ref>', 'node reference in format <node-name@instance-suffix>')
    .option('-f, --file <path>', 'JSON file containing the result')
    .option('--value <json>', 'inline JSON value for the result')
    .option('--json', 'output result as JSON')
    .action(
      withErrorHandler(
        async (
          nodeRef: string,
          options: {
            file?: string
            value?: string
            json?: boolean
          },
        ) => {
          // Parse node reference: <node-name>@<instance-suffix>
          const { nodeName, instanceSuffix } = parseNodeRef(nodeRef)

          // Find the matching run by scanning for instance suffix
          const runIds = await listRunIds()
          const rid = runIds.find((id) => id.endsWith(`@${instanceSuffix}`))
          if (!rid) {
            throw new ValidationError(
              `no workflow instance found matching suffix @${instanceSuffix}`,
            )
          }

          // Load graph for that run
          const graphName = await runService.getGraphForRun(rid)
          if (!graphName) {
            throw new ValidationError(`workflow instance ${rid} is not bound to a graph`)
          }

          const graph = await graphService.loadCompiledGraph(graphName)

          // Look up node from graph.nodes
          const node = graph.nodes?.find((n) => n.name === nodeName)
          if (!node) {
            throw new ValidationError(`node '${nodeName}' not found in workflow '${graphName}'`)
          }

          if (!node.stateKey) {
            throw new ValidationError(
              `node '${nodeName}' does not have a stateKey, nothing to collect`,
            )
          }

          // Load the collect task
          const collectName = `collect-${nodeName}`
          const state = await workflowService.loadState(rid)
          const collectTask = state.currentRecord.tasks.find((t) => t.nodeId === collectName)
          if (!collectTask) {
            throw new ValidationError(
              `collect task '${collectName}' not found in current superstep`,
            )
          }
          if (collectTask.status !== 'ready') {
            throw new ValidationError(
              `collect task '${collectName}' is '${collectTask.status}', cannot collect (expected 'ready')`,
            )
          }

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

          // Write to state channel: _state.<stateKey> = resultValue
          const channelName = stateChannelName(node.stateKey)
          await workflowService.startTask(collectName, rid)
          await workflowService.setChannel(channelName, resultValue, rid)

          // Complete the collect task
          const edges = graph.edges
          await workflowService.completeTask(collectName, edges, rid)

          if (options.json) {
            outputJson({
              nodeName,
              instanceId: rid,
              stateKey: node.stateKey,
              channel: channelName,
              value: resultValue,
              collectTask: collectName,
              status: 'success',
            })
          } else {
            console.log(`Collected '${node.stateKey}' for ${nodeName} (${rid})`)
            console.log(`  Channel: ${channelName}`)
            console.log(`  Value: ${JSON.stringify(resultValue)}`)
            console.log(`  Task: ${collectName} → success`)
          }
        },
      ),
    )
}
