import { Command } from 'commander'
import './default-deps.js'
import { registerHelpCommand } from '../slices/help/index.js'
import { registerNextCommand } from '../slices/next/index.js'
import { registerLogCommand } from '../slices/log/index.js'
import { registerCollectCommand } from '../slices/collect/index.js'
import { registerLsCommand } from '../slices/ls/index.js'
import { registerGraphCommand } from '../slices/graph/index.js'
import { registerStartCommand } from '../slices/start/index.js'
import { registerPsCommand } from '../slices/ps/index.js'
import { registerShowCommand } from '../slices/show/index.js'
import { registerCompileCommand } from '../slices/compile/index.js'
import { getCommandMeta } from '../slices/_shared/command-meta.js'
import { formatManHelp } from '../slices/_shared/format-help.js'

export function run(): void {
  const program = new Command()
  program.name('dagman')

  program.configureHelp({
    sortSubcommands: true,
    sortOptions: true,
  })

  registerHelpCommand(program)
  registerLsCommand(program)
  registerGraphCommand(program)
  registerStartCommand(program)
  registerPsCommand(program)
  registerShowCommand(program)
  registerCompileCommand(program)
  registerNextCommand(program)
  registerCollectCommand(program)
  registerLogCommand(program)

  // Attach man page style after-help to all commands that have metadata
  for (const cmd of program.commands) {
    attachHelpText(cmd)
  }

  program.parse()
}

function attachHelpText(cmd: Command): void {
  const meta = getCommandMeta(cmd)
  if (meta) {
    cmd.addHelpText('after', formatManHelp(cmd))
  }
}
