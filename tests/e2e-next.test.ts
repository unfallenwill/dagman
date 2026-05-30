/**
 * E2E test for `dagman next` — full A→B→C lifecycle
 * Uses domain API to drive state, Commander to invoke CLI slices
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Command } from 'commander'
import '../src/engine/default-deps.js'
import { registerNextCommand } from '../src/slices/next/index.js'
import { registerLogCommand } from '../src/slices/log/index.js'
import {
  initTmpDir,
  cleanupTmpDir,
  installMockLoadGraph,
  storeGraph,
  buildGraph,
} from './helpers/setup.js'
import * as runService from '../src/domain/run/run-service.js'
import * as workflowService from '../src/domain/workflow/workflow-engine.js'
import type { Edge } from '../src/shared/models/graph.js'

let logSpy: ReturnType<typeof vi.spyOn>
let errSpy: ReturnType<typeof vi.spyOn>
let exitSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  initTmpDir()
  installMockLoadGraph()
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

function createProgram(...registerFns: Array<(p: Command) => void>): Command {
  const program = new Command()
  program.exitOverride()
  program.configureOutput({ writeErr: () => {} })
  for (const fn of registerFns) fn(program)
  return program
}

/**
 * Set up a running workflow — same pattern as next.test.ts
 */
async function setupRunningWorkflow(
  nodeNames: string[],
  edges: Edge[] = [],
  graphName = 'e2e-graph',
): Promise<string> {
  storeGraph(graphName, buildGraph(nodeNames, edges, graphName, { kind: 'collect' }))
  const info = await runService.createRun(undefined, graphName, true)
  return info.id
}

function getLog(): string[] {
  return logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
}

// Graph: A → B → C (3 layers via edges)
const chainEdges: Edge[] = [
  { from: 'B', to: 'A' },
  { from: 'C', to: 'B' },
]

describe('E2E: dagman next — full A→B→C workflow', () => {
  it('Step 0: createRun → next shows A ready', async () => {
    const runId = await setupRunningWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-01')

    const prog = createProgram(registerNextCommand)
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId])

    expect(exitSpy).not.toHaveBeenCalled()
    const out = getLog()
    expect(out.some((l) => l.includes('Node: A'))).toBe(true)
    expect(out.some((l) => l.includes('Status: ready'))).toBe(true)
  })

  it('Step 0: next --all --json returns [A]', async () => {
    const runId = await setupRunningWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-02')

    const prog = createProgram(registerNextCommand)
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId, '--all', '--json'])

    expect(exitSpy).not.toHaveBeenCalled()
    const parsed = JSON.parse(getLog()[0]!)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].node.name).toBe('A')
    expect(parsed[0].task.status).toBe('ready')
  })

  it('Step 0: next --step shows step 0 running with A', async () => {
    const runId = await setupRunningWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-03')

    const prog = createProgram(registerNextCommand)
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId, '--step'])

    expect(exitSpy).not.toHaveBeenCalled()
    const out = getLog()
    expect(out.some((l) => l.includes('Current step: 0'))).toBe(true)
    expect(out.some((l) => l.includes('A [ready]'))).toBe(true)
  })

  it('Step 1: startTask(A) + completeTask(A) → next shows B ready', async () => {
    const runId = await setupRunningWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-04')

    // Drive state through domain API (same as next.test.ts)
    await workflowService.startTask('A', runId)
    await workflowService.completeTask('A', chainEdges, runId)

    const prog = createProgram(registerNextCommand)
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId])

    expect(exitSpy).not.toHaveBeenCalled()
    const out = getLog()
    expect(out.some((l) => l.includes('Node: B'))).toBe(true)
    expect(out.some((l) => l.includes('Status: ready'))).toBe(true)
  })

  it('Step 1: next --step shows step 1 with B ready', async () => {
    const runId = await setupRunningWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-05')

    await workflowService.startTask('A', runId)
    await workflowService.completeTask('A', chainEdges, runId)

    const prog = createProgram(registerNextCommand)
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId, '--step'])

    expect(exitSpy).not.toHaveBeenCalled()
    const out = getLog()
    expect(out.some((l) => l.includes('Current step: 1'))).toBe(true)
    expect(out.some((l) => l.includes('B [ready]'))).toBe(true)
  })

  it('Step 2: complete A+B → next shows C ready', async () => {
    const runId = await setupRunningWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-06')

    await workflowService.startTask('A', runId)
    await workflowService.completeTask('A', chainEdges, runId)
    await workflowService.startTask('B', runId)
    await workflowService.completeTask('B', chainEdges, runId)

    const prog = createProgram(registerNextCommand)
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId])

    expect(exitSpy).not.toHaveBeenCalled()
    const out = getLog()
    expect(out.some((l) => l.includes('Node: C'))).toBe(true)
  })

  it('Step 3: complete A+B+C → next says no executable tasks', async () => {
    const runId = await setupRunningWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-07')

    await workflowService.startTask('A', runId)
    await workflowService.completeTask('A', chainEdges, runId)
    await workflowService.startTask('B', runId)
    await workflowService.completeTask('B', chainEdges, runId)
    await workflowService.startTask('C', runId)
    await workflowService.completeTask('C', chainEdges, runId)

    const prog = createProgram(registerNextCommand)
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId])

    expect(exitSpy).not.toHaveBeenCalled()
    const out = getLog()
    expect(out.some((l) => l.includes('No executable tasks'))).toBe(true)
  })

  it('Workflow done: next --all --json returns []', async () => {
    const runId = await setupRunningWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-08')

    await workflowService.startTask('A', runId)
    await workflowService.completeTask('A', chainEdges, runId)
    await workflowService.startTask('B', runId)
    await workflowService.completeTask('B', chainEdges, runId)
    await workflowService.startTask('C', runId)
    await workflowService.completeTask('C', chainEdges, runId)

    const prog = createProgram(registerNextCommand)
    await prog.parseAsync(['node', 'dag', 'next', '--run', runId, '--all', '--json'])

    expect(exitSpy).not.toHaveBeenCalled()
    expect(JSON.parse(getLog()[0]!)).toEqual([])
  })

  it('dagman log shows full 6-event history after A→B→C', async () => {
    const runId = await setupRunningWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-09')

    await workflowService.startTask('A', runId)
    await workflowService.completeTask('A', chainEdges, runId)
    await workflowService.startTask('B', runId)
    await workflowService.completeTask('B', chainEdges, runId)
    await workflowService.startTask('C', runId)
    await workflowService.completeTask('C', chainEdges, runId)

    const prog = createProgram(registerLogCommand)
    await prog.parseAsync(['node', 'dag', 'log', '--run', runId, '--json'])

    expect(exitSpy).not.toHaveBeenCalled()
    const parsed = JSON.parse(getLog()[0]!)
    expect(parsed.events).toHaveLength(6)
    const nodes = parsed.events.map((e: { node: string }) => e.node)
    expect(nodes).toEqual(['A', 'A', 'B', 'B', 'C', 'C'])
  })

  it('dagman log <node> filters events for that node', async () => {
    const runId = await setupRunningWorkflow(['A', 'B', 'C'], chainEdges, 'e2e-10')

    await workflowService.startTask('A', runId)
    await workflowService.completeTask('A', chainEdges, runId)
    await workflowService.startTask('B', runId)
    await workflowService.completeTask('B', chainEdges, runId)

    const prog = createProgram(registerLogCommand)
    await prog.parseAsync(['node', 'dag', 'log', 'B', '--run', runId, '--json'])

    expect(exitSpy).not.toHaveBeenCalled()
    const parsed = JSON.parse(getLog()[0]!)
    expect(parsed.events).toHaveLength(2)
    expect(parsed.events.every((e: { node: string }) => e.node === 'B')).toBe(true)
  })

  it('dagman next --run nonexistent exits with error', async () => {
    const prog = createProgram(registerNextCommand)
    await prog.parseAsync(['node', 'dag', 'next', '--run', 'nonexistent@000'])

    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
