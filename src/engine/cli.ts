import { Command } from 'commander'
import { applyWorkflowsDir } from './default-deps.js'
import { registerHelpCommand } from '../slices/help/index.js'
import { registerNextCommand } from '../slices/next/index.js'
import { registerCollectCommand } from '../slices/collect/index.js'
import { registerLsCommand } from '../slices/ls/index.js'
import { registerStartCommand } from '../slices/start/index.js'
import { registerPsCommand } from '../slices/ps/index.js'
import { registerShowCommand } from '../slices/show/index.js'
import { getCommandMeta } from '../slices/_shared/command-meta.js'
import { formatManHelp } from '../slices/_shared/format-help.js'

export function createProgram(): Command {
  const program = new Command()
  program.name('dagman')

  program.configureHelp({
    sortSubcommands: true,
    sortOptions: true,
  })

  // Global option for custom workflows directory
  program.option(
    '--workflows-dir <path>',
    'Custom workflows directory (replaces default locations)',
  )

  // Wire --workflows-dir into DI before any command action runs
  program.hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts()
    if (opts.workflowsDir) {
      applyWorkflowsDir(opts.workflowsDir as string)
    }
  })

  registerHelpCommand(program)
  registerLsCommand(program)
  registerStartCommand(program)
  registerPsCommand(program)
  registerShowCommand(program)
  registerNextCommand(program)
  registerCollectCommand(program)

  // Attach man page style after-help to all commands that have metadata
  for (const cmd of program.commands) {
    attachHelpText(cmd)
  }

  return program
}

export function run(argv: string[] = process.argv): void {
  const program = createProgram()
  program.parse(argv)
}

function attachHelpText(cmd: Command): void {
  const meta = getCommandMeta(cmd)
  if (meta) {
    cmd.addHelpText('after', formatManHelp(cmd))
  }
}
