import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import '../../src/engine/default-deps.js'
import * as workflowService from '../../src/workflow/workflow.js'
import * as runService from '../../src/runtime/run.js'
import { computeTopologicalLayers } from '../../src/shared/utils/topology.js'
import type { Edge } from '../../src/shared/models/graph.js'

const TMP_DIR = path.join(os.tmpdir(), `dagman-workflow-test-${Date.now()}`)

let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  await fs.mkdir(TMP_DIR, { recursive: true })
  process.chdir(TMP_DIR)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.rm(TMP_DIR, { recursive: true, force: true })
})

// Helper: create compiled graph and run
async function setupGraph(
  nodeNames: string[],
  edges: Edge[],
  graphName = 'test-graph',
): Promise<string> {
  await fs.mkdir(path.join(TMP_DIR, '.dagman/graphs'), { recursive: true })

  const nodes = nodeNames.map((name) => ({
    name,
    description: `Node ${name}`,
    instructions: `Do ${name}`,
    kind: 'user' as const,
  }))

  const graphData = {
    name: graphName,
    edges,
    nodes,
  }

  await fs.writeFile(
    path.join(TMP_DIR, `.dagman/graphs/${graphName}.json`),
    JSON.stringify(graphData, null, 2),
  )

  const info = await runService.createRun('wf-test', graphName, true)
  return info.id
}

describe('computeTopologicalLayers', () => {
  it('should compute layers for linear graph', () => {
    const edges: Edge[] = [
      { from: 'b', to: 'a' },
      { from: 'c', to: 'b' },
    ]
    const layers = computeTopologicalLayers(edges, ['a', 'b', 'c'])
    expect(layers.get(0)).toEqual(['a'])
    expect(layers.get(1)).toEqual(['b'])
    expect(layers.get(2)).toEqual(['c'])
  })

  it('should compute layers for diamond graph', () => {
    const edges: Edge[] = [
      { from: 'b', to: 'a' },
      { from: 'c', to: 'a' },
      { from: 'd', to: 'b' },
      { from: 'd', to: 'c' },
    ]
    const layers = computeTopologicalLayers(edges, ['a', 'b', 'c', 'd'])
    expect(layers.get(0)).toEqual(['a'])
    const layer1 = layers.get(1)!.sort()
    expect(layer1).toEqual(['b', 'c'])
    expect(layers.get(2)).toEqual(['d'])
  })

  it('should handle nodes with no edges', () => {
    const layers = computeTopologicalLayers([], ['standalone'])
    expect(layers.get(0)).toEqual(['standalone'])
  })

  it('should handle empty input', () => {
    const layers = computeTopologicalLayers([], [])
    expect(layers.size).toBe(0)
  })
})

describe('initWorkflow', () => {
  it('should initialize workflow.jsonl with layer 0 tasks', async () => {
    const runId = await setupGraph(
      ['a', 'b', 'c'],
      [
        { from: 'b', to: 'a' },
        { from: 'c', to: 'a' },
      ],
    )

    const state = await workflowService.loadState(runId)
    expect(state.currentRecord.step).toBe(0)
    expect(state.currentRecord.status).toBe('running')
    expect(state.currentRecord.tasks.length).toBe(1)
    expect(state.currentRecord.tasks[0]!.nodeId).toBe('a')
    expect(state.currentRecord.tasks[0]!.status).toBe('ready')

    // Edge channel should be initialized
    const edgeChannel = state.channels['edge:a→b']!
    expect(edgeChannel).toBeDefined()
    expect(edgeChannel.version).toBe(0)
    expect(edgeChannel.value).toBeNull()
  })

  it('should initialize all layer 0 nodes for graph with multiple roots', async () => {
    const runId = await setupGraph(
      ['a', 'b', 'c'],
      [
        { from: 'c', to: 'a' },
        { from: 'c', to: 'b' },
      ],
    )

    const tasks = await workflowService.listTasks(runId)
    expect(tasks.length).toBe(2)
    const ids = tasks.map((t) => t.nodeId).sort()
    expect(ids).toEqual(['a', 'b'])
  })
})

describe('task lifecycle', () => {
  it('should start a ready task', async () => {
    const runId = await setupGraph(['a'], [])
    const task = await workflowService.startTask('a', runId)
    expect(task.status).toBe('running')
    expect(task.startedAt).toBeDefined()
  })

  it('should complete a running task', async () => {
    const runId = await setupGraph(['a', 'b'], [{ from: 'b', to: 'a' }])

    await workflowService.startTask('a', runId)
    const { task, advanced } = await workflowService.completeTask(
      'a',
      [{ from: 'b', to: 'a' }],
      runId,
    )
    expect(task.status).toBe('success')
    expect(advanced).toBe(true) // Auto-advance to layer 1
  })

  it('should fail a running task', async () => {
    const runId = await setupGraph(['a'], [])
    await workflowService.startTask('a', runId)
    const task = await workflowService.failTask('a', runId, 'something went wrong')
    expect(task.status).toBe('failed')
    expect(task.error).toBe('something went wrong')
  })

  it('should retry a failed task', async () => {
    const runId = await setupGraph(['a'], [])
    await workflowService.startTask('a', runId)
    await workflowService.failTask('a', runId)

    const task = await workflowService.retryTask('a', runId)
    expect(task.status).toBe('ready')
    expect(task.startedAt).toBeUndefined()
    expect(task.completedAt).toBeUndefined()
  })

  it('should skip a ready task', async () => {
    const runId = await setupGraph(['a'], [])
    const { task } = await workflowService.skipTask('a', [], runId)
    expect(task.status).toBe('skipped')
  })

  it('should reject invalid transitions', async () => {
    const runId = await setupGraph(['a'], [])
    // Cannot complete a task that's not running
    await expect(workflowService.completeTask('a', [], runId)).rejects.toThrow(/cannot complete/)
  })
})

describe('channel operations', () => {
  it('should set and get channels', async () => {
    const runId = await setupGraph(['a'], [])

    const ch = await workflowService.setChannel('a.output', 'result data', runId)
    expect(ch.version).toBe(1)
    expect(ch.value).toBe('result data')

    const retrieved = await workflowService.getChannel('a.output', runId)
    expect(retrieved?.value).toBe('result data')
    expect(retrieved?.version).toBe(1)
  })

  it('should increment version on re-set', async () => {
    const runId = await setupGraph(['a'], [])

    await workflowService.setChannel('a.key', 'v1', runId)
    const ch = await workflowService.setChannel('a.key', 'v2', runId)
    expect(ch.version).toBe(2)
  })

  it('should list channels by node', async () => {
    const runId = await setupGraph(['a', 'b'], [])

    await workflowService.setChannel('a.key1', 'val1', runId)
    await workflowService.setChannel('a.key2', 'val2', runId)
    await workflowService.setChannel('b.key1', 'val3', runId)

    const aChannels = await workflowService.listChannels(runId, 'a')
    expect(aChannels.length).toBe(2)

    const allChannels = await workflowService.listChannels(runId)
    expect(allChannels.length).toBe(3)
  })

  it('should clear channels for a node', async () => {
    const runId = await setupGraph(['a'], [])
    await workflowService.setChannel('a.key1', 'val', runId)
    await workflowService.setChannel('a.key2', 'val', runId)

    await workflowService.clearChannels('a', runId)

    const ch1 = await workflowService.getChannel('a.key1', runId)
    expect(ch1?.value).toBeNull()
    expect(ch1?.version).toBe(2)
  })

  it('should handle global channels', async () => {
    const runId = await setupGraph(['a'], [])
    const ch = await workflowService.setGlobalChannel('project', 'dagman', runId)
    expect(ch.version).toBe(1)

    const retrieved = await workflowService.getGlobalChannel('project', runId)
    expect(retrieved?.value).toBe('dagman')
  })
})

describe('superstep advancement', () => {
  it('should auto-advance when all tasks complete', async () => {
    const runId = await setupGraph(
      ['a', 'b', 'c'],
      [
        { from: 'b', to: 'a' },
        { from: 'c', to: 'b' },
      ],
    )

    // Layer 0: a
    await workflowService.startTask('a', runId)
    const { advanced: adv1 } = await workflowService.completeTask(
      'a',
      [
        { from: 'b', to: 'a' },
        { from: 'c', to: 'b' },
      ],
      runId,
    )
    expect(adv1).toBe(true)

    // Layer 1: b
    const tasks1 = await workflowService.listTasks(runId)
    expect(tasks1.length).toBe(1)
    expect(tasks1[0]!.nodeId).toBe('b')

    await workflowService.startTask('b', runId)
    const { advanced: adv2 } = await workflowService.completeTask(
      'b',
      [
        { from: 'b', to: 'a' },
        { from: 'c', to: 'b' },
      ],
      runId,
    )
    expect(adv2).toBe(true)

    // Layer 2: c
    const tasks2 = await workflowService.listTasks(runId)
    expect(tasks2.length).toBe(1)
    expect(tasks2[0]!.nodeId).toBe('c')
  })

  it('should pause superstep when task fails', async () => {
    const runId = await setupGraph(['a'], [])

    await workflowService.startTask('a', runId)
    await workflowService.failTask('a', runId, 'error')

    const ready = await workflowService.findReadyTasks(runId)
    expect(ready.length).toBe(0) // No tasks should be ready when failed

    // Retry should resume
    await workflowService.retryTask('a', runId)
    const readyAfterRetry = await workflowService.findReadyTasks(runId)
    expect(readyAfterRetry.length).toBe(1)
  })

  it('should complete workflow when last layer finishes', async () => {
    const runId = await setupGraph(['a'], [])

    await workflowService.startTask('a', runId)
    await workflowService.completeTask('a', [], runId)

    const complete = await workflowService.isWorkflowComplete(runId)
    expect(complete).toBe(true)
  })
})

describe('workflow.jsonl snapshot', () => {
  it('should accumulate channel changes across records', async () => {
    const runId = await setupGraph(['a'], [])

    await workflowService.setChannel('a.output', 'step1', runId)
    await workflowService.setChannel('a.output', 'step2', runId)

    const state = await workflowService.loadState(runId)
    expect(state.channels['a.output']!.value).toBe('step2')
    expect(state.channels['a.output']!.version).toBe(2)
  })

  it('should record channel changes on task completion', async () => {
    const runId = await setupGraph(['a', 'b'], [{ from: 'b', to: 'a' }])

    await workflowService.startTask('a', runId)
    await workflowService.completeTask('a', [{ from: 'b', to: 'a' }], runId)

    const state = await workflowService.loadState(runId)
    const edgeChannel = state.channels['edge:a→b']!
    expect(edgeChannel).toBeDefined()
    expect(edgeChannel.version).toBe(1)
    expect(edgeChannel.value).toBe('success')
  })
})
