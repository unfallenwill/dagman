import type { Command } from 'commander'
import type { RunInfo, Task } from '../../shared/models/compiled-graph.js'
import { executeStep } from '../../domain/engine/execution-engine.js'
import { readState } from '../../domain/engine/state-service.js'
import { resolveActiveRunId } from '../../domain/run/run-resolver.js'
import { setCommandMeta } from '../_shared/command-meta.js'
import { withErrorHandler, outputJson } from '../_shared/output.js'
import { FsTaskRepository } from '../../infra/fs/fs-task-repo.js'
import { FsRunStoreAdapter } from '../../infra/fs/fs-run-store-adapter.js'
import { FsRunRepository } from '../../infra/fs/fs-run-repo.js'

/** Lazy-initialized store instances for reading display data */
let _taskStore: FsTaskRepository | undefined
let _runStore: FsRunStoreAdapter | undefined

function getTaskStore(): FsTaskRepository {
  return (_taskStore ??= new FsTaskRepository())
}

function getRunStore(): FsRunStoreAdapter {
  return (_runStore ??= new FsRunStoreAdapter(new FsRunRepository()))
}

export function registerNextCommand(program: Command): void {
  const nextCmd = program
    .command('next')
    .summary('Get the next executable task')
    .description(
      `Execute the next step in the current run.

This is the core execution command. It finds all triggered nodes in the
current superstep, executes them, and advances the run to the next layer.

Use --step to inspect the current superstep status without executing.
Use --all (or run without flags) to execute the next step.

The agent execution loop typically follows: next -> (nodes execute) -> next -> ...`,
    )

  setCommandMeta(nextCmd, {
    examples: [
      { description: 'Execute the next step', command: 'dagman next' },
      { description: 'Execute next step as JSON', command: 'dagman next --json' },
      {
        description: 'Check current superstep status',
        command: 'dagman next --step',
      },
      {
        description: 'Execute next step for a specific run',
        command: 'dagman next --run demo@abc123',
      },
    ],
    exitStatus: [
      { code: 0, meaning: 'Success (step executed or no tasks remaining)' },
      { code: 1, meaning: 'Error (run not found, workflow not initialized)' },
    ],
    seeAlso: ['dagman-start(1)', 'dagman-collect(1)'],
    dataProducing: true,
  })

  nextCmd
    .option('-r, --run <name@id>', 'specify workflow instance (defaults to active)')
    .option('--all', 'execute the next step (same as default behavior)')
    .option('--step', 'show current superstep status without executing')
    .option('--json', 'output in JSON format')
    .action(
      withErrorHandler(
        async (options: { run?: string; all?: boolean; step?: boolean; json?: boolean }) => {
          const runId = options.run ?? (await resolveActiveRunId())

          // --step: display current superstep status without executing
          if (options.step) {
            await displayStepStatus(runId, options.json)
            return
          }

          // Default / --all: execute the next step
          const result = await executeStep(runId)

          if (result.executed.length === 0 && result.completed) {
            if (options.json) {
              outputJson({ executed: [], completed: true, status: 'completed' })
              return
            }
            console.log('Run completed — no more steps to execute')
            return
          }

          if (result.executed.length === 0) {
            if (options.json) {
              outputJson({ executed: [], completed: false })
              return
            }
            console.log('No executable tasks in the current step')
            return
          }

          // Read updated info and tasks for display
          const [runInfo, tasks, state] = await Promise.all([
            getRunStore().read(runId),
            getTaskStore().readAll(runId),
            readState(runId).catch(() => ({})),
          ])

          if (options.json) {
            outputJson({
              executed: result.executed,
              completed: result.completed,
              step: runInfo.currentStep,
              status: runInfo.status,
              state,
              tasks,
            })
            return
          }

          displayExecutionResult(result, runInfo, tasks, state)
        },
      ),
    )
}

/** Display the current superstep status without executing */
async function displayStepStatus(runId: string, json?: boolean): Promise<void> {
  const [runInfo, allTasks] = await Promise.all([
    getRunStore().read(runId),
    getTaskStore().readAll(runId),
  ])

  const stepTasks = allTasks.filter((t) => t.step === runInfo.currentStep)
  const totalSteps = await estimateTotalSteps(runId)

  if (json) {
    outputJson({
      step: runInfo.currentStep,
      totalSteps,
      status: runInfo.status,
      tasks: stepTasks,
    })
    return
  }

  console.log(`Step ${runInfo.currentStep + 1}/${totalSteps} — status: ${runInfo.status}`)
  console.log('Tasks:')
  for (const t of stepTasks) {
    const icon = taskIcon(t)
    console.log(`  ${icon} ${t.nodeId} (${t.status})`)
  }
}

/** Display execution result in human-readable format */
function displayExecutionResult(
  result: { executed: string[]; completed: boolean },
  runInfo: RunInfo,
  tasks: Task[],
  state: Record<string, unknown>,
): void {
  // Show executed nodes with their final status
  console.log(`Step ${runInfo.currentStep}: ${result.executed.length} node(s) executed`)
  for (const nodeId of result.executed) {
    const task = tasks.find(
      (t) => t.nodeId === nodeId && t.step === runInfo.currentStep - (result.completed ? 0 : 1),
    )
    // Fallback: find the most recent task for this node
    const nodeTask = task ?? tasks.filter((t) => t.nodeId === nodeId).at(-1)
    const status = nodeTask?.status ?? 'unknown'
    const icon = status === 'success' ? '✓' : status === 'failed' ? '✗' : '·'
    console.log(`  ${icon} ${nodeId} → ${status}`)
  }

  // Show state
  const stateKeys = Object.keys(state)
  if (stateKeys.length > 0) {
    console.log('\nState:')
    for (const [key, value] of Object.entries(state)) {
      const display = typeof value === 'string' ? `"${value}"` : String(value)
      console.log(`  ${key}: ${display}`)
    }
  }

  // Show run status
  const totalSteps = '?' // We don't have graph info here; show what we have
  console.log(`\nRun status: ${runInfo.status} (step ${runInfo.currentStep}/${totalSteps})`)
}

/** Get a display icon for a task */
function taskIcon(task: Task): string {
  switch (task.status) {
    case 'success':
      return '✓'
    case 'failed':
      return '✗'
    case 'running':
      return '⟳'
    case 'ready':
      return '→'
    default:
      return '·'
  }
}

/** Estimate total steps from the graph file (best effort) */
async function estimateTotalSteps(_runId: string): Promise<number> {
  // The total layers info is in graph.json, but reading it here would require
  // importing getGraphFile + readJSON. For now, return 0 to indicate unknown.
  // The --step display will show "step N/?"
  return 0
}
