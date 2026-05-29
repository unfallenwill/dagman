import type { Command } from 'commander'
import { compileWorkflow } from '../domain/compiler/compiler.js'
import { withErrorHandler } from '../slices/_shared/output.js'

export function registerCompileCommand(program: Command): void {
  program
    .command('compile <name>')
    .summary('Dry-run compile (validate without persisting)')
    .action(
      withErrorHandler(async (name: string) => {
        const result = await compileWorkflow(name)
        console.log(
          'Compile OK: ' + result.nodes.length + ' nodes, ' + result.graph.edges.length + ' edges',
        )
      }),
    )
}
