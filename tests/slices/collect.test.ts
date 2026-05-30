import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as path from 'path'
import * as fs from 'fs/promises'
import { Command } from 'commander'
import '../../src/engine/default-deps.js'
import { registerCollectCommand } from '../../src/slices/collect/index.js'
import { initTmpDir, cleanupTmpDir } from '../helpers/setup.js'
import * as runService from '../../src/domain/run/run-service.js'
import * as workflowService from '../../src/domain/workflow/workflow-engine.js'
import { getGraphsDir, getRunsDir } from '../../src/infra/fs/paths.js'
import { createTask } from '../../src/shared/models/task.js'

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
  registerCollectCommand(program)
  return program
}

/**
 * Create a compiled graph JSON file with nodes that may have stateKey.
 */
async function createCompiledGraph(
  name: string,
  nodes: Array<{
    name: string
    stateKey?: string
    kind?: string
    description?: string
    instructions?: string
    parentNodeId?: string
  }>,
  edges: Array<{ from: string; to: string; expect?: string }>,
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
      kind: n.kind ?? 'user',
      ...(n.stateKey ? { stateKey: n.stateKey } : {}),
      ...(n.parentNodeId ? { parentNodeId: n.parentNodeId } : {}),
    })),
  }
  await fs.writeFile(path.join(graphsDir, `${name}.json`), JSON.stringify(graphData, null, 2))
}

/**
 * Full setup for collect command: graph with a node that has stateKey,
 * a run bound to that graph, and a workflow.jsonl containing a collect task.
 */
async function setupCollectScenario(
  nodeName = 'classify',
  stateKey = 'intent',
  graphName = 'test-graph',
  taskStatus: 'ready' | 'running' | 'success' = 'ready',
): Promise<{ runId: string; suffix: string; nodeRef: string }> {
  // Create graph with a node that has a stateKey + its collect node
  await createCompiledGraph(
    graphName,
    [
      { name: nodeName, stateKey, kind: 'user' },
      { name: `collect-${nodeName}`, kind: 'collect', parentNodeId: nodeName },
    ],
    [{ from: `collect-${nodeName}`, to: nodeName }],
  )

  // Create run bound to the graph
  const info = await runService.createRun(undefined, graphName, true)
  const runId = info.id

  // Add a collect-<nodeName> task to the current superstep by rewriting the last record
  const state = await workflowService.loadState(runId)
  const currentRecord = state.currentRecord

  const collectTask = createTask(`collect-${nodeName}`, currentRecord.step, 'collect', nodeName)
  collectTask.status = taskStatus

  const updatedRecord = {
    ...currentRecord,
    tasks: [...currentRecord.tasks, collectTask],
  }

  const runsDir = getRunsDir()
  const jsonlPath = path.join(runsDir, runId, 'workflow.jsonl')
  const content = await fs.readFile(jsonlPath, 'utf-8')
  const lines = content.trim().split('\n')
  lines[lines.length - 1] = JSON.stringify(updatedRecord)
  await fs.writeFile(jsonlPath, lines.join('\n') + '\n')

  // Parse suffix from runId (format: graphName@hex)
  const atIdx = runId.lastIndexOf('@')
  const suffix = runId.slice(atIdx + 1)
  const nodeRef = `${nodeName}@${suffix}`

  return { runId, suffix, nodeRef }
}

// ===== Positive (happy path) tests =====

describe('collect command — positive cases', () => {
  it('should collect with --value option and complete the task', async () => {
    const { runId, nodeRef } = await setupCollectScenario()

    const program = createProgram()
    await program.parseAsync([
      'node',
      'dagman',
      'collect',
      nodeRef,
      '--value',
      '{"intent":"need_tool"}',
    ])

    expect(exitSpy).not.toHaveBeenCalled()

    // Verify console output mentions the collected key
    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    expect(calls.some((line: string) => line.includes("Collected 'intent'"))).toBe(true)
    expect(calls.some((line: string) => line.includes('_state.intent'))).toBe(true)

    // Verify the channel was written
    const ch = await workflowService.getChannel('_state.intent', runId)
    expect(ch).not.toBeNull()
    expect(ch!.value).toEqual({ intent: 'need_tool' })
  })

  it('should collect with --file option and complete the task', async () => {
    const { runId, nodeRef } = await setupCollectScenario('process', 'result')

    // Write a JSON result file to a temp location
    const tmpBase = path.resolve('..') // after initTmpDir, cwd is tmpDir
    const resultPath = path.join(tmpBase, 'result.json')
    await fs.writeFile(resultPath, JSON.stringify({ output: 'processed' }))

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'collect', nodeRef, '--file', resultPath])

    expect(exitSpy).not.toHaveBeenCalled()

    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    expect(calls.some((line: string) => line.includes("Collected 'result'"))).toBe(true)

    const ch = await workflowService.getChannel('_state.result', runId)
    expect(ch).not.toBeNull()
    expect(ch!.value).toEqual({ output: 'processed' })
  })

  it('should output JSON with --json flag', async () => {
    const { nodeRef } = await setupCollectScenario('analyze', 'analysis')

    const program = createProgram()
    await program.parseAsync([
      'node',
      'dagman',
      'collect',
      nodeRef,
      '--value',
      '{"type":"report"}',
      '--json',
    ])

    expect(exitSpy).not.toHaveBeenCalled()

    const jsonOutput = logSpy.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(jsonOutput)
    expect(parsed.nodeName).toBe('analyze')
    expect(parsed.stateKey).toBe('analysis')
    expect(parsed.channel).toBe('_state.analysis')
    expect(parsed.value).toEqual({ type: 'report' })
    expect(parsed.status).toBe('success')
    expect(parsed.collectTask).toBe('collect-analyze')
  })
})

// ===== Negative (error/edge case) tests =====

describe('collect command — negative cases', () => {
  it('should fail with invalid node reference format (no @ separator)', async () => {
    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'collect', 'no-at-separator', '--value', '{}'])

    expect(exitSpy).toHaveBeenCalledWith(1)
    const errMsg = errSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join(' ')
    expect(errMsg).toContain('invalid node reference')
  })

  it('should fail when instance suffix matches no run', async () => {
    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'collect', 'classify@deadbeef', '--value', '{}'])

    expect(exitSpy).toHaveBeenCalledWith(1)
    const errMsg = errSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join(' ')
    expect(errMsg).toContain('no workflow instance found')
  })

  it('should fail when run is not bound to a graph', async () => {
    // Create a run without graphName by writing directly
    const runsDir = getRunsDir()
    const runDir = path.join(runsDir, 'nograph@test1')
    await fs.mkdir(runDir, { recursive: true })
    await fs.writeFile(
      path.join(runDir, 'run.json'),
      JSON.stringify({
        id: 'nograph@test1',
        createdAt: new Date().toISOString(),
        currentStep: 0,
        status: 'idle',
      }),
    )

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'collect', 'classify@test1', '--value', '{}'])

    expect(exitSpy).toHaveBeenCalledWith(1)
    const errMsg = errSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join(' ')
    expect(errMsg).toContain('not bound to a graph')
  })

  it('should fail when node is not found in graph', async () => {
    const { suffix } = await setupCollectScenario('classify', 'intent')
    // Use a node name that doesn't exist in the graph, but with the real suffix
    const program = createProgram()
    await program.parseAsync([
      'node',
      'dagman',
      'collect',
      `nonexistent@${suffix}`,
      '--value',
      '{}',
    ])

    expect(exitSpy).toHaveBeenCalledWith(1)
    const errMsg = errSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join(' ')
    expect(errMsg).toContain('not found')
  })

  it('should fail when node has no stateKey', async () => {
    // Create a graph with a node that has NO stateKey
    await createCompiledGraph('no-statekey-graph', [{ name: 'bare-node' }], [])
    const info = await runService.createRun(undefined, 'no-statekey-graph', true)
    const suffix = info.id.split('@')[1]!

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'collect', `bare-node@${suffix}`, '--value', '{}'])

    expect(exitSpy).toHaveBeenCalledWith(1)
    const errMsg = errSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join(' ')
    expect(errMsg).toContain('does not have a stateKey')
  })

  it('should fail when no collect task in current superstep', async () => {
    // Create a graph with a stateKey node but NO collect-<node> task in the step
    await createCompiledGraph(
      'no-collect-task-graph',
      [{ name: 'classify', stateKey: 'intent' }],
      [],
    )
    const info = await runService.createRun(undefined, 'no-collect-task-graph', true)
    const suffix = info.id.split('@')[1]!

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'collect', `classify@${suffix}`, '--value', '{}'])

    expect(exitSpy).toHaveBeenCalledWith(1)
    const errMsg = errSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join(' ')
    expect(errMsg).toContain("collect task 'collect-classify' not found")
  })

  it('should fail when collect task is not in ready status', async () => {
    // Set up with collect task in 'running' status
    const { nodeRef } = await setupCollectScenario('classify', 'intent', 'test-graph', 'running')

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'collect', nodeRef, '--value', '{}'])

    expect(exitSpy).toHaveBeenCalledWith(1)
    const errMsg = errSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join(' ')
    expect(errMsg).toContain('cannot collect')
  })

  it('should fail when neither --file nor --value is provided', async () => {
    const { nodeRef } = await setupCollectScenario()

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'collect', nodeRef])

    expect(exitSpy).toHaveBeenCalledWith(1)
    const errMsg = errSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join(' ')
    expect(errMsg).toContain('must provide --file')
  })

  it('should fail when --file points to non-existent file', async () => {
    const { nodeRef } = await setupCollectScenario()

    const program = createProgram()
    await program.parseAsync([
      'node',
      'dagman',
      'collect',
      nodeRef,
      '--file',
      '/nonexistent/path/result.json',
    ])

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('should fail when --value contains invalid JSON', async () => {
    const { nodeRef } = await setupCollectScenario()

    const program = createProgram()
    await program.parseAsync(['node', 'dagman', 'collect', nodeRef, '--value', 'not-valid-json{'])

    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
