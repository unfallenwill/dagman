import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import * as workflowService from '../../src/workflow/workflow.js'
import * as runService from '../../src/runtime/run.js'
import {
  condChannelName,
  stateChannelName,
  fanoutChannelName,
} from '../../src/shared/models/channel.js'
import { filterByCondEdge } from '../../src/scheduling/next.js'
import type { Edge } from '../../src/shared/models/graph.js'
import type { Task } from '../../src/shared/models/task.js'
import type { Channel } from '../../src/shared/models/channel.js'
import { createTask } from '../../src/shared/models/task.js'

const TMP_DIR = path.join(os.tmpdir(), `dagman-phase3-test-${Date.now()}`)

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

// Helper: create compiled graph with embedded nodes + run
async function setupCompiledRun(
  nodeNames: string[],
  edges: Edge[],
  graphName = 'test-graph',
): Promise<string> {
  await fs.mkdir(path.join(TMP_DIR, '.dagman/graphs'), { recursive: true })

  const nodes = nodeNames.map((name) => ({
    name,
    description: `Node ${name}`,
    instructions: '',
    kind: 'user' as const,
  }))

  const graphData = {
    name: graphName,
    edges,
    nodes,
  }

  await fs.writeFile(
    path.join(TMP_DIR, `.dagman/graphs/${graphName}.json`),
    JSON.stringify(graphData, null, 2) + '\n',
  )

  const info = await runService.createRun('phase3-test', graphName, true)
  return info.id
}

describe('condEdge channel naming', () => {
  it('builds correct condEdge channel name', () => {
    const name = condChannelName('cond:classify→route')
    expect(name).toBe('_cond.cond:classify→route')
  })
})

describe('stateChannelName', () => {
  it('builds correct state channel name', () => {
    expect(stateChannelName('intent')).toBe('_state.intent')
    expect(stateChannelName('answer')).toBe('_state.answer')
  })
})

describe('filterByCondEdge', () => {
  it('does not filter tasks without condEdge upstream', async () => {
    const edges: Edge[] = [{ from: 'b', to: 'a' }]
    const channels: Record<string, Channel> = {}
    const tasks: Task[] = [createTask('a', 0), createTask('b', 1)]

    const runId = await setupCompiledRun(['a', 'b'], edges)

    const result = await filterByCondEdge(tasks, edges, channels, runId)
    expect(result).toHaveLength(2)
  })

  it('filters tasks blocked by condEdge (tasks in workflow)', async () => {
    // Build a graph: classify → cond:classify→route → tool, chat
    // All in the same superstep so tasks exist in workflow.jsonl
    const edges: Edge[] = [
      { from: 'cond:classify→route', to: 'classify' },
      { from: 'tool', to: 'cond:classify→route' },
      { from: 'chat', to: 'cond:classify→route' },
    ]

    const runId = await setupCompiledRun(['classify', 'tool', 'chat', 'cond:classify→route'], edges)

    // Complete layer 0 (classify)
    await workflowService.startTask('classify', runId)
    await workflowService.completeTask('classify', edges, runId)

    // Layer 1: cond:classify→route
    await workflowService.startTask('cond:classify→route', runId)
    await workflowService.completeTask('cond:classify→route', edges, runId)

    // Now layer 2: tool and chat are ready tasks
    const readyTasks = await workflowService.findReadyTasks(runId)
    expect(readyTasks).toHaveLength(2)

    // Set condEdge channel: tool wins
    const state = await workflowService.loadState(runId)
    const channels = { ...state.channels }
    channels[condChannelName('cond:classify→route')] = {
      name: condChannelName('cond:classify→route'),
      value: 'tool',
      version: 1,
      updatedAt: new Date().toISOString(),
    }

    const result = await filterByCondEdge(readyTasks, edges, channels, runId)
    expect(result).toHaveLength(1)
    expect(result[0]!.nodeId).toBe('tool')
  })

  it('filters all tasks if condEdge channel is not set', async () => {
    const edges: Edge[] = [
      { from: 'cond:classify→route', to: 'classify' },
      { from: 'tool', to: 'cond:classify→route' },
      { from: 'chat', to: 'cond:classify→route' },
    ]

    const runId = await setupCompiledRun(['classify', 'tool', 'chat', 'cond:classify→route'], edges)

    // Complete layer 0 + 1 to reach layer 2
    await workflowService.startTask('classify', runId)
    await workflowService.completeTask('classify', edges, runId)
    await workflowService.startTask('cond:classify→route', runId)
    await workflowService.completeTask('cond:classify→route', edges, runId)

    const readyTasks = await workflowService.findReadyTasks(runId)
    const state = await workflowService.loadState(runId)
    // No condEdge channel set → all filtered
    const result = await filterByCondEdge(readyTasks, edges, state.channels, runId)
    expect(result).toHaveLength(0)
  })
})

describe('workflow lifecycle with compiled graph', () => {
  it('creates run with compiled JSON graph', async () => {
    const edges: Edge[] = [
      { from: 'b', to: 'a' },
      { from: 'c', to: 'b' },
    ]
    const runId = await setupCompiledRun(['a', 'b', 'c'], edges)

    const state = await workflowService.loadState(runId)
    expect(state.currentRecord.step).toBe(0)
    expect(state.currentRecord.tasks).toHaveLength(1)
    expect(state.currentRecord.tasks[0]!.nodeId).toBe('a')
  })

  it('advances through supersteps with compiled graph', async () => {
    const edges: Edge[] = [{ from: 'b', to: 'a' }]
    const runId = await setupCompiledRun(['a', 'b'], edges)

    // Complete layer 0: a
    await workflowService.startTask('a', runId)
    const { advanced } = await workflowService.completeTask('a', edges, runId)
    expect(advanced).toBe(true)

    // Layer 1: b should be ready
    const state = await workflowService.loadState(runId)
    expect(state.currentRecord.step).toBe(1)
    expect(state.currentRecord.tasks[0]!.nodeId).toBe('b')
    expect(state.currentRecord.tasks[0]!.status).toBe('ready')
  })

  it('writes and reads state channels', async () => {
    const edges: Edge[] = [{ from: 'b', to: 'a' }]
    const runId = await setupCompiledRun(['a', 'b'], edges)

    // Write a state channel
    await workflowService.setChannel(stateChannelName('intent'), 'need_tool', runId)

    const ch = await workflowService.getChannel(stateChannelName('intent'), runId)
    expect(ch).toBeDefined()
    expect(ch!.value).toBe('need_tool')
    expect(ch!.version).toBe(1)
  })
})

describe('collect workflow', () => {
  it('collect task lifecycle: start → set channel → complete', async () => {
    const edges: Edge[] = [
      { from: 'collect-a', to: 'a' },
      { from: 'b', to: 'collect-a' },
    ]

    // Nodes: a (user with stateKey), collect-a, b
    const nodes = [
      {
        name: 'a',
        description: 'Node a',
        instructions: '',
        kind: 'user' as const,
        stateKey: 'output',
      },
      {
        name: 'collect-a',
        description: 'Node collect-a',
        instructions: '',
        kind: 'collect' as const,
        parentNodeId: 'a',
        stateKey: 'output',
      },
      {
        name: 'b',
        description: 'Node b',
        instructions: '',
        kind: 'user' as const,
      },
    ]

    // Create run with the topology
    await fs.mkdir(path.join(TMP_DIR, '.dagman/graphs'), { recursive: true })
    await fs.writeFile(
      path.join(TMP_DIR, '.dagman/graphs/collect-test.json'),
      JSON.stringify({ name: 'collect-test', edges, nodes }, null, 2) + '\n',
    )

    const runId = (await runService.createRun('collect-test', 'collect-test', true)).id

    // Complete layer 0: a
    await workflowService.startTask('a', runId)
    await workflowService.completeTask('a', edges, runId)

    // Layer 1: collect-a should be ready
    const readyTasks = await workflowService.findReadyTasks(runId)
    expect(readyTasks).toHaveLength(1)
    expect(readyTasks[0]!.nodeId).toBe('collect-a')

    // Simulate collect: start → set channel → complete
    await workflowService.startTask('collect-a', runId)
    await workflowService.setChannel(stateChannelName('output'), 'result-value', runId)
    const { advanced } = await workflowService.completeTask('collect-a', edges, runId)
    expect(advanced).toBe(true)

    // Verify state channel
    const ch = await workflowService.getChannel(stateChannelName('output'), runId)
    expect(ch!.value).toBe('result-value')

    // Layer 2: b should be ready
    const state = await workflowService.loadState(runId)
    expect(state.currentRecord.step).toBe(2)
    expect(state.currentRecord.tasks[0]!.nodeId).toBe('b')
  })
})

describe('fanout dynamic task creation', () => {
  it('creates dynamic tasks from fanout channel', async () => {
    const { getFanoutItemsForNode } = await import('../../src/workflow/workflow.js')

    // Simulate fanout channel with 3 items
    const channels: Record<string, Channel> = {
      '_fanout.fanout:source→process': {
        name: '_fanout.fanout:source→process',
        value: ['item1', 'item2', 'item3'],
        version: 1,
        updatedAt: new Date().toISOString(),
      },
    }

    const items = await getFanoutItemsForNode('process', channels)
    expect(items).toEqual(['item1', 'item2', 'item3'])
  })

  it('returns null for non-fanout nodes', async () => {
    const { getFanoutItemsForNode } = await import('../../src/workflow/workflow.js')

    const channels: Record<string, Channel> = {}
    const items = await getFanoutItemsForNode('some-node', channels)
    expect(items).toBeNull()
  })

  it('fanout channel naming is correct', () => {
    expect(fanoutChannelName('fanout:source→process')).toBe('_fanout.fanout:source→process')
  })
})
