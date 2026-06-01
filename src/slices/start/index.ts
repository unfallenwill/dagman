import type { Command } from 'commander'
import { compile } from '../../domain/compiler/compiler.js'
import { initRun } from '../../domain/engine/execution-engine.js'
import { setCurrentRunId } from '../../domain/run/run-resolver.js'
import { generateInstanceId } from '../../shared/utils/id.js'
import { setCommandMeta } from '../_shared/command-meta.js'
import { withErrorHandler } from '../_shared/output.js'

export function registerStartCommand(program: Command): void {
  const startCmd = program.command('start <name>').summary('Start a workflow instance')
    .description(`Compile a workflow and start a new run instance.

Compiles the named workflow TypeScript definition into a graph,
generates a unique run ID, initializes the run state, and sets it
as the current active run. The run auto-computes topological layers
from the graph definition.

This is a combined compile-and-start operation — no separate compile
step is needed.`)

  setCommandMeta(startCmd, {
    examples: [
      { description: 'Start a workflow', command: 'dagman start my-workflow' },
      {
        description: 'Start and view status',
        command: 'dagman start my-workflow && dagman next --step',
      },
    ],
    exitStatus: [
      { code: 0, meaning: 'Success (run created and set as active)' },
      { code: 1, meaning: 'Error (workflow not found, compilation failed)' },
    ],
    seeAlso: ['dagman-ls(1)', 'dagman-next(1)', 'dagman-show(1)'],
    dataProducing: false,
  })

  startCmd.action(
    withErrorHandler(async (name: string) => {
      // Compile workflow into CompiledGraph
      const compiledGraph = await compile(name)

      // Generate run ID and initialize run
      const runId = generateInstanceId(name)
      const runInfo = await initRun(runId, compiledGraph)

      // Set as current run
      await setCurrentRunId(runId)

      console.log(runInfo.id)
    }),
  )
}
