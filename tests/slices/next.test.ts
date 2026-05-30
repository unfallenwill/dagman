import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as path from 'path'
import * as fs from 'fs/promises'
import { Command } from 'commander'
import '../../src/engine/default-deps.js'
import { registerNextCommand } from '../../src/slices/next/index.js'
import { initTmpDir, cleanupTmpDir } from '../helpers/setup.js'
import * as runService from '../../src/domain/run/run-service.js'
import * as workflowService from '../../src/domain/workflow/workflow-engine.js'
import { getGraphsDir } from '../../src/infra/fs/paths.js'
import type { Edge } from '../../src/shared/models/graph.js'

let logSpy: ReturnType<typeof vi.spyOn>
let errSpy: ReturnType<typeof vi.spyOn>
let exitSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  initTmpDir()
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)
})

afterEach(async () => {
  logSpy.mockRestore()
  errSpy.mockRestore()
  exitSpy.mockRestore()
  await cleanupTmpDir()
})

function createProgram(): Command {
  const program = new Command()
  program.exitOverride()
  program.configureOutput({ writeErr: () => {} })
  registerNextCommand(program)
  return program
}

/**
 * Create a compiled graph JSON file.
 */
async function createCompiledGraph(
  name: string,
  nodes: Array<{
    name: string
    kind?: string
    description?: string
    instructions?: string
  }>,
  edges: Edge[],
): Promise<void> {
  const graphsDir = getGraphsDir()
  await fs.mkdir(graphsDir, { recursive: true })
  const graphData = {
    name,
    edges,
    nodes: nodes.map((n) => ({
      name: n.name,
      description: n.description ?? `Node ${n.name}`,
      instructions: n.instructions ?? `Instructions for ${n.name}`,
      kind: n.kind ?? 'collect',
    })),
  }
  await fs.writeFile(path.join(graphsDir, `${name}.json`), JSON.stringify(graphData, null, 2))
}

/**
 * Set up a running workflow with the given nodes and edges.
 * Returns the run ID. The workflow will have ready tasks for layer 0.
 */
async function setupRunningWorkflow(
  nodeNames: string[],
  edges: Edge[] = [],
  graphName = 'next-test-graph',
): Promise<string> {
  await createCompiledGraph(
    graphName,
    nodeNames.map((n) => ({ name: n })),
    edges,
  )
  const info = await runService.createRun(undefined, graphName, true)
  return info.id
}

/**
 * Complete all tasks in the current step, advancing the workflow to a completed state.
 * This makes no tasks ready.
 */
async function completeAllTasks(runId: string, edges: Edge[]): Promise<void> {
  const state = await workflowService.loadState(runId)
  const readyTasks = state.currentRecord.tasks.filter((t) => t.status === 'ready')

  for (const task of readyTasks) {
    await workflowService.startTask(task.nodeId, runId)
    await workflowService.completeTask(task.nodeId, edges, runId)
  }
}

// ===== Positive (happy path) tests =====

describe('next command — positive cases', () => {
  it('should return a single ready task from a running workflow', async () => {
    const edges: Edge[] = []
    await setupRunningWorkflow(['alpha'], edges)

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next'])

    expect(exitSpy).not.toHaveBeenCalled()

    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    expect(calls.some((line: string) => line.includes('Node: alpha'))).toBe(true)
    expect(calls.some((line: string) => line.includes('Status: ready'))).toBe(true)
  })

  it('should output JSON with --json flag for a single task', async () => {
    const edges: Edge[] = []
    await setupRunningWorkflow(['beta'], edges)

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--json'])

    expect(exitSpy).not.toHaveBeenCalled()

    const jsonOutput = logSpy.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(jsonOutput)
    expect(parsed.node).toBeDefined()
    expect(parsed.node.name).toBe('beta')
    expect(parsed.task).toBeDefined()
    expect(parsed.task.status).toBe('ready')
    expect(parsed.channels).toBeDefined()
  })

  it('should return all ready tasks with --all flag', async () => {
    const edges: Edge[] = []
    await setupRunningWorkflow(['alpha', 'bravo', 'charlie'], edges)

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--all'])

    expect(exitSpy).not.toHaveBeenCalled()

    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    expect(calls.some((line: string) => line.includes('Node: alpha'))).toBe(true)
    expect(calls.some((line: string) => line.includes('Node: bravo'))).toBe(true)
    expect(calls.some((line: string) => line.includes('Node: charlie'))).toBe(true)
  })

  it('should return all ready tasks as JSON array with --all --json', async () => {
    const edges: Edge[] = []
    await setupRunningWorkflow(['alpha', 'bravo'], edges)

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--all', '--json'])

    expect(exitSpy).not.toHaveBeenCalled()

    const jsonOutput = logSpy.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(jsonOutput)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(2)
    const names = parsed.map((r: { node: { name: string } }) => r.node.name).sort()
    expect(names).toEqual(['alpha', 'bravo'])
  })

  it('should show current step info with --step flag', async () => {
    const edges: Edge[] = []
    await setupRunningWorkflow(['alpha'], edges)

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--step'])

    expect(exitSpy).not.toHaveBeenCalled()

    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    expect(calls.some((line: string) => line.includes('Current step: 0'))).toBe(true)
    expect(calls.some((line: string) => line.includes('alpha'))).toBe(true)
  })

  it('should show step info as JSON with --step --json', async () => {
    const edges: Edge[] = []
    await setupRunningWorkflow(['alpha'], edges)

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--step', '--json'])

    expect(exitSpy).not.toHaveBeenCalled()

    const jsonOutput = logSpy.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(jsonOutput)
    expect(parsed.step).toBe(0)
    expect(parsed.status).toBe('running')
    expect(parsed.tasks.length).toBeGreaterThanOrEqual(1)
    const taskNames = parsed.tasks.map((t: { nodeId: string }) => t.nodeId)
    expect(taskNames).toContain('alpha')
  })

  it('should select explicit run with --run option', async () => {
    const edges: Edge[] = []
    const runId = await setupRunningWorkflow(['gamma'], edges, 'explicit-run-graph')

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--run', runId])

    expect(exitSpy).not.toHaveBeenCalled()

    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    expect(calls.some((line: string) => line.includes('Node: gamma'))).toBe(true)
  })
})

// ===== Negative (error/edge case) tests =====

describe('next command — negative cases', () => {
  it('should show "No executable tasks" when all tasks are completed', async () => {
    const edges: Edge[] = []
    const runId = await setupRunningWorkflow(['alpha'], edges)
    // Complete all tasks to exhaust the superstep (single layer, single node => workflow done)
    await completeAllTasks(runId, edges)

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next'])

    expect(exitSpy).not.toHaveBeenCalled()

    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    expect(calls.some((line: string) => line.includes('No executable tasks'))).toBe(true)
  })

  it('should return empty JSON with --all --json when no tasks are ready', async () => {
    const edges: Edge[] = []
    const runId = await setupRunningWorkflow(['alpha'], edges)
    await completeAllTasks(runId, edges)

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--all', '--json'])

    expect(exitSpy).not.toHaveBeenCalled()

    const jsonOutput = logSpy.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(jsonOutput)
    expect(parsed).toEqual([])
  })

  it('should show "No executable tasks" with --all when no tasks are ready', async () => {
    const edges: Edge[] = []
    const runId = await setupRunningWorkflow(['alpha'], edges)
    await completeAllTasks(runId, edges)

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--all'])

    expect(exitSpy).not.toHaveBeenCalled()

    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    expect(calls.some((line: string) => line.includes('No executable tasks'))).toBe(true)
  })

  it('should fail when no active run exists (no .current-run, no running instances)', async () => {
    // Create an idle run that is NOT running — resolveActiveRunId should find no active runs
    await runService.createRun('idle-label')

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next'])

    expect(exitSpy).toHaveBeenCalledWith(1)
    const errMsg = errSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join(' ')
    expect(errMsg).toContain('No active run found')
  })

  it('should fail when --run specifies a non-existent run ID', async () => {
    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'next', '--run', 'nonexistent@00000000'])

    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
