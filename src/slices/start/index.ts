import type { Command } from 'commander'
import { compile } from '../../domain/compiler/compiler.js'
import { initRun } from '../../domain/engine/execution-engine.js'
import { setCurrentRunId } from '../../domain/run/run-resolver.js'
import { generateInstanceId } from '../../shared/utils/id.js'
import { withErrorHandler } from '../_shared/output.js'

export function registerStartCommand(program: Command): void {
  program
    .command('start <name>')
    .summary('Start a workflow instance')
    .action(
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
