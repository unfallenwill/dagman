import type { Command } from 'commander'
import { readFileSync } from 'fs'
import * as path from 'path'
import { CliError } from '../../shared/errors.js'

function getVersion(): string {
  try {
    // Search upward from script directory for package.json (dist/src/slices/help/index.js -> package.json)
    const pkgPath = path.resolve(__dirname, '../../../../package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    return pkg.version ?? '0.0.0'
  } catch {
    // Fallback to cwd
    try {
      const pkgPath = path.resolve('package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      return pkg.version ?? '0.0.0'
    } catch {
      return '0.0.0'
    }
  }
}

/** Static overview content — concepts, workflow, edge semantics, variables. */
function buildOverview(version: string): string {
  return `dagman v${version} — DAG-based agent task orchestration CLI

━━━ Overview ━━━

dagman is a task scheduler based on directed acyclic graphs (DAGs). It executes
workflow nodes one topological layer at a time via \`dagman next\`.

Core execution loop:
  start -> loop { next } -> done

━━━ Core Concepts ━━━

Node      Static task definition (name + function), carries no runtime state
Graph     DAG topology, declares dependencies between nodes via edges
Run       Execution instance of a graph, created via \`dagman start <name>\`
Task      Runtime entity, created from a Node, lifecycle: ready -> running -> success / failed
Superstep BFS-layered execution, all ready tasks within a layer can run in parallel, advance when all reach terminal state
Channel   Versioned signal for coordination between nodes:
            trigger:<target>    Single-source edge (version 0->1 = fired)
            barrier:<target>    Multi-source join (all writers must write)

━━━ Workflow ━━━

1. Write a TypeScript workflow definition using the builder API
2. dagman ls                                # List available workflows
3. dagman show <name>                       # Inspect workflow graph and metadata
4. dagman start <name>                      # Compile and start a run instance
5. dagman next                              # Execute the next step
6. Go back to step 5, repeat until the run is completed

━━━ Edge Semantics ━━━

Edge { from, to } means from triggers to — from executes first, then to can run.
Edges are compiled into channels: single-source edges become trigger channels,
multi-source joins (diamond DAGs) become barrier channels.

━━━ More Help ━━━

  dagman <command> --help    Show subcommand usage
`
}

/** Dynamic command reference — generated from registered Commander commands. */
function buildCommandReference(program: Command): string {
  const groups: Record<string, Array<{ usage: string; summary: string }>> = {}

  // Categorize commands into groups
  const discoveryCommands = ['ls', 'show']
  const executionCommands = ['start', 'ps']
  const schedulingCommands = ['next']

  for (const cmd of program.commands) {
    const cmdName = cmd.name()
    if (cmdName === 'help') continue

    let category: string
    if (discoveryCommands.includes(cmdName)) {
      category = 'Discovery'
    } else if (executionCommands.includes(cmdName)) {
      category = 'Execution'
    } else if (schedulingCommands.includes(cmdName)) {
      category = 'Scheduling'
    } else {
      category = 'Other'
    }

    groups[category] ??= []

    const args = cmd.usage().replace(cmdName, '').trim()
    const usage = `${cmdName}${args ? ' ' + args : ''}`
    const summary = cmd.summary() || (cmd.description().split('\n')[0] ?? '')
    groups[category]!.push({ usage: usage.padEnd(32), summary })
  }

  const categoryOrder = ['Discovery', 'Execution', 'Scheduling', 'Other']
  const lines: string[] = ['━━━ Command Reference ━━━\n']

  for (const category of categoryOrder) {
    const items = groups[category]
    if (!items || items.length === 0) continue
    lines.push(`${category}:`)
    for (const item of items) {
      lines.push(`  ${item.usage}${item.summary}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function registerHelpCommand(program: Command): void {
  program.description('DAG-based agent task orchestration CLI').version(getVersion())

  program
    .command('help [subcommand]')
    .summary('Show usage guide or subcommand help')
    .description(
      `Show the full usage guide, or detailed help for a specific subcommand.

Without arguments, displays the complete guide including core concepts,
workflow, and command reference.
With a subcommand name, shows man page style help for that command.`,
    )
    .action((subcommand?: string) => {
      if (subcommand) {
        const cmd = program.commands.find((c) => c.name() === subcommand)
        if (cmd) {
          cmd.outputHelp()
        } else {
          throw new CliError(`Unknown command: ${subcommand}`)
        }
      } else {
        console.log(buildOverview(getVersion()))
        console.log(buildCommandReference(program))
      }
    })
}
