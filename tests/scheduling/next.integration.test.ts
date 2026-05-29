import { describe, it, expect, afterEach } from 'vitest'
import { initTmpDir, cleanupTmpDir } from '../helpers/setup.js'
import * as next from '../../src/scheduling/next.js'
import * as workflowService from '../../src/workflow/workflow.js'
import * as runService from '../../src/runtime/run.js'
import type { Edge } from '../../src/models/graph.js'
import type { Node } from '../../src/models/node.js'
import type { WorkflowDefinition } from '../../src/models/workflow-def.js'
import type { WorkflowLoader } from '../../src/utils/loader.js'
import { condChannelName, fanoutChannelName } from '../../src/models/channel.js'
import * as fs from 'fs/promises'
import * as path from 'path'

// ===== Test Helpers =====

/**
 * Create a compiled graph JSON file in the test's tmpdir and start a run.
 * Returns the run ID.
 */
async function setupGraphAndRun(
  nodes: Node[],
  edges: Edge[],
  graphName = 'test-graph',
): Promise<string> {
  const tmpDir = initTmpDir()
  await fs.mkdir(path.join(tmpDir, '.dagman/graphs'), { recursive: true })

  const graphData = { name: graphName, edges, nodes }
  await fs.writeFile(
    path.join(tmpDir, `.dagman/graphs/${graphName}.json`),
    JSON.stringify(graphData, null, 2),
  )

  const info = await runService.createRun(undefined, graphName, true)
  return info.id
}

/**
 * Create a mock WorkflowLoader that returns a predefined definition.
 */
function createMockLoader(definition: WorkflowDefinition): WorkflowLoader {
  return {
    async load() {
      return definition
    },
  }
}

/**
 * Helper to complete a task: start then complete.
 */
async function completeTask(nodeId: string, edges: Edge[], runId: string): Promise<void> {
  await workflowService.startTask(nodeId, runId)
  await workflowService.completeTask(nodeId, edges, runId)
}

// ===== findNext Tests =====

describe('findNext (integration)', () => {
  afterEach(async () => {
    await cleanupTmpDir()
  })

  it('returns null when no tasks are ready', async () => {
    const nodes: Node[] = [
      { name: 'a', description: 'Node a', instructions: 'Do a' },
      { name: 'b', description: 'Node b', instructions: 'Do b' },
    ]
    const edges: Edge[] = [{ from: 'b', to: 'a' }]
    const runId = await setupGraphAndRun(nodes, edges)

    // Complete the only ready task 'a'
    await completeTask('a', edges, runId)

    // Start task 'b' so it's running, not ready
    await workflowService.startTask('b', runId)

    const result = await next.findNext(runId)
    expect(result).toBeNull()
  })

  it('returns the first ready task sorted alphabetically', async () => {
    const nodes: Node[] = [
      { name: 'a', description: 'Node a', instructions: 'Do a' },
      { name: 'b', description: 'Node b', instructions: 'Do b' },
      { name: 'c', description: 'Node c', instructions: 'Do c' },
    ]
    const edges: Edge[] = [
      { from: 'b', to: 'a' },
      { from: 'c', to: 'a' },
    ]
    const runId = await setupGraphAndRun(nodes, edges)

    // Complete layer 0 task 'a'
    await completeTask('a', edges, runId)

    // Now 'b' and 'c' are ready; 'b' comes first alphabetically
    const result = await next.findNext(runId)
    expect(result).not.toBeNull()
    expect(result!.task.nodeId).toBe('b')
    expect(result!.node.name).toBe('b')
    expect(result!.instructions).toBe('Do b')
    expect(result!.channels).toBeDefined()
  })

  it('returns the single root task when no edges', async () => {
    const nodes: Node[] = [{ name: 'solo', description: 'Solo node', instructions: 'Do solo' }]
    const edges: Edge[] = []
    const runId = await setupGraphAndRun(nodes, edges)

    const result = await next.findNext(runId)
    expect(result).not.toBeNull()
    expect(result!.task.nodeId).toBe('solo')
    expect(result!.node.name).toBe('solo')
  })

  it('returns null when all ready tasks are filtered by condEdge', async () => {
    const nodes: Node[] = [
      { name: 'classify', description: 'Classify', instructions: '' },
      { name: 'cond:classify→route', description: 'Cond', instructions: '', kind: 'cond' },
      { name: 'tool', description: 'Tool', instructions: '' },
      { name: 'chat', description: 'Chat', instructions: '' },
    ]
    const edges: Edge[] = [
      { from: 'cond:classify→route', to: 'classify' },
      { from: 'tool', to: 'cond:classify→route' },
      { from: 'chat', to: 'cond:classify→route' },
    ]
    const runId = await setupGraphAndRun(nodes, edges)

    // Complete layers 0 and 1
    await completeTask('classify', edges, runId)
    await completeTask('cond:classify→route', edges, runId)

    // Do NOT set cond channel → all tasks filtered
    const result = await next.findNext(runId)
    expect(result).toBeNull()
  })

  it('skips cond-blocked tasks and returns the passing one', async () => {
    const nodes: Node[] = [
      { name: 'classify', description: 'Classify', instructions: '' },
      { name: 'cond:classify→route', description: 'Cond', instructions: '', kind: 'cond' },
      { name: 'tool', description: 'Tool', instructions: 'Use tool' },
      { name: 'chat', description: 'Chat', instructions: 'Use chat' },
    ]
    const edges: Edge[] = [
      { from: 'cond:classify→route', to: 'classify' },
      { from: 'tool', to: 'cond:classify→route' },
      { from: 'chat', to: 'cond:classify→route' },
    ]
    const runId = await setupGraphAndRun(nodes, edges)

    // Complete layers 0 and 1
    await completeTask('classify', edges, runId)
    await completeTask('cond:classify→route', edges, runId)

    // Set cond channel to 'tool'
    await workflowService.setChannel(condChannelName('cond:classify→route'), 'tool', runId)

    const result = await next.findNext(runId)
    expect(result).not.toBeNull()
    expect(result!.task.nodeId).toBe('tool')
  })

  it('executes user node via loader and completes it', async () => {
    const nodes: Node[] = [{ name: 'a', description: 'Node a', instructions: 'Do a', kind: 'user' }]
    const edges: Edge[] = []
    const runId = await setupGraphAndRun(nodes, edges)

    let fnCalled = false
    const mockLoader = createMockLoader({
      name: 'test-graph',
      stateSchema: {},
      nodes: [
        {
          name: 'a',
          fn: () => {
            fnCalled = true
          },
        },
      ],
      edges: [],
      condEdges: [],
      fanOuts: [],
    })

    const result = await next.findNext(runId, { loader: mockLoader })
    expect(result).not.toBeNull()
    expect(result!.task.nodeId).toBe('a')
    expect(fnCalled).toBe(true)

    // Verify the node was executed by checking persisted state
    const state = await workflowService.loadState(runId)
    const persistedTask = state.currentRecord.tasks.find((t) => t.nodeId === 'a')
    expect(persistedTask?.status).toBe('success')
  })

  it('executes cond node via loader and sets cond channel', async () => {
    const nodes: Node[] = [
      { name: 'classify', description: 'Classify', instructions: '' },
      { name: 'cond:classify→route', description: 'Cond', instructions: '', kind: 'cond' },
      { name: 'tool', description: 'Tool', instructions: '' },
      { name: 'chat', description: 'Chat', instructions: '' },
    ]
    const edges: Edge[] = [
      { from: 'cond:classify→route', to: 'classify' },
      { from: 'tool', to: 'cond:classify→route' },
      { from: 'chat', to: 'cond:classify→route' },
    ]
    const runId = await setupGraphAndRun(nodes, edges)

    // Complete layer 0
    await completeTask('classify', edges, runId)

    // Now cond:classify→route is ready (layer 1)
    const mockLoader = createMockLoader({
      name: 'test-graph',
      stateSchema: {},
      nodes: [],
      edges,
      condEdges: [
        {
          nodeName: 'cond:classify→route',
          from: 'classify',
          targets: ['tool', 'chat'],
          fn: () => 'chat',
        },
      ],
      fanOuts: [],
    })

    const result = await next.findNext(runId, { loader: mockLoader })
    expect(result).not.toBeNull()
    expect(result!.task.nodeId).toBe('cond:classify→route')

    // Verify cond channel was set and task was completed
    const state = await workflowService.loadState(runId)
    const condCh = state.channels[condChannelName('cond:classify→route')]
    expect(condCh).toBeDefined()
    expect(condCh!.value).toBe('chat')
  })

  it('executes fanout node via loader and sets fanout channel', async () => {
    const nodes: Node[] = [
      { name: 'source', description: 'Source', instructions: '' },
      {
        name: 'fanout:source→process',
        description: 'FanOut',
        instructions: '',
        kind: 'fanout',
        templateNode: 'process',
      },
    ]
    const edges: Edge[] = [{ from: 'fanout:source→process', to: 'source' }]
    const runId = await setupGraphAndRun(nodes, edges)

    // Complete layer 0
    await completeTask('source', edges, runId)

    // fanout:source→process is now ready (layer 1)
    const mockLoader = createMockLoader({
      name: 'test-graph',
      stateSchema: {},
      nodes: [],
      edges,
      condEdges: [],
      fanOuts: [
        {
          nodeName: 'fanout:source→process',
          from: 'source',
          templateNode: 'process',
          fn: () => ['item1', 'item2', 'item3'],
        },
      ],
    })

    const result = await next.findNext(runId, { loader: mockLoader })
    expect(result).not.toBeNull()
    expect(result!.task.nodeId).toBe('fanout:source→process')

    // Verify fanout channel was set
    const state = await workflowService.loadState(runId)
    const fanoutCh = state.channels[fanoutChannelName('fanout:source→process')]
    expect(fanoutCh).toBeDefined()
    expect(fanoutCh!.value).toEqual(['item1', 'item2', 'item3'])
  })

  it('throws when user node fn is not found in workflow definition', async () => {
    const nodes: Node[] = [{ name: 'a', description: 'Node a', instructions: 'Do a', kind: 'user' }]
    const edges: Edge[] = []
    const runId = await setupGraphAndRun(nodes, edges)

    // Loader returns empty nodes array (node 'a' not found)
    const mockLoader = createMockLoader({
      name: 'test-graph',
      stateSchema: {},
      nodes: [],
      edges: [],
      condEdges: [],
      fanOuts: [],
    })

    await expect(next.findNext(runId, { loader: mockLoader })).rejects.toThrow(
      "node 'a' not found in workflow definition",
    )
  })

  it('throws when cond node fn is not found in workflow definition', async () => {
    const nodes: Node[] = [
      { name: 'classify', description: 'Classify', instructions: '' },
      { name: 'cond:classify→route', description: 'Cond', instructions: '', kind: 'cond' },
    ]
    const edges: Edge[] = [{ from: 'cond:classify→route', to: 'classify' }]
    const runId = await setupGraphAndRun(nodes, edges)

    // Complete layer 0
    await completeTask('classify', edges, runId)

    // Loader returns empty condEdges
    const mockLoader = createMockLoader({
      name: 'test-graph',
      stateSchema: {},
      nodes: [],
      edges,
      condEdges: [],
      fanOuts: [],
    })

    await expect(next.findNext(runId, { loader: mockLoader })).rejects.toThrow(
      "condEdge 'cond:classify→route' not found in workflow definition",
    )
  })

  it('throws when fanout node fn is not found in workflow definition', async () => {
    const nodes: Node[] = [
      { name: 'source', description: 'Source', instructions: '' },
      {
        name: 'fanout:source→process',
        description: 'FanOut',
        instructions: '',
        kind: 'fanout',
      },
    ]
    const edges: Edge[] = [{ from: 'fanout:source→process', to: 'source' }]
    const runId = await setupGraphAndRun(nodes, edges)

    // Complete layer 0
    await completeTask('source', edges, runId)

    // Loader returns empty fanOuts
    const mockLoader = createMockLoader({
      name: 'test-graph',
      stateSchema: {},
      nodes: [],
      edges,
      condEdges: [],
      fanOuts: [],
    })

    await expect(next.findNext(runId, { loader: mockLoader })).rejects.toThrow(
      "fanOut 'fanout:source→process' not found in workflow definition",
    )
  })

  it('fails task when user node fn throws an error', async () => {
    const nodes: Node[] = [{ name: 'a', description: 'Node a', instructions: 'Do a', kind: 'user' }]
    const edges: Edge[] = []
    const runId = await setupGraphAndRun(nodes, edges)

    const mockLoader = createMockLoader({
      name: 'test-graph',
      stateSchema: {},
      nodes: [
        {
          name: 'a',
          fn: () => {
            throw new Error('node execution failed')
          },
        },
      ],
      edges: [],
      condEdges: [],
      fanOuts: [],
    })

    await expect(next.findNext(runId, { loader: mockLoader })).rejects.toThrow(
      'node execution failed',
    )

    // Verify task was marked as failed
    const task = await workflowService.getTask('a', runId)
    expect(task?.status).toBe('failed')
    expect(task?.error).toBe('node execution failed')
  })

  it('fails task when cond node fn throws an error', async () => {
    const nodes: Node[] = [
      { name: 'classify', description: 'Classify', instructions: '' },
      { name: 'cond:classify→route', description: 'Cond', instructions: '', kind: 'cond' },
    ]
    const edges: Edge[] = [{ from: 'cond:classify→route', to: 'classify' }]
    const runId = await setupGraphAndRun(nodes, edges)

    // Complete layer 0
    await completeTask('classify', edges, runId)

    const mockLoader = createMockLoader({
      name: 'test-graph',
      stateSchema: {},
      nodes: [],
      edges,
      condEdges: [
        {
          nodeName: 'cond:classify→route',
          from: 'classify',
          targets: ['tool'],
          fn: () => {
            throw new Error('cond evaluation failed')
          },
        },
      ],
      fanOuts: [],
    })

    await expect(next.findNext(runId, { loader: mockLoader })).rejects.toThrow(
      'cond evaluation failed',
    )

    const task = await workflowService.getTask('cond:classify→route', runId)
    expect(task?.status).toBe('failed')
    expect(task?.error).toBe('cond evaluation failed')
  })

  it('fails task when fanout node fn throws an error', async () => {
    const nodes: Node[] = [
      { name: 'source', description: 'Source', instructions: '' },
      {
        name: 'fanout:source→process',
        description: 'FanOut',
        instructions: '',
        kind: 'fanout',
      },
    ]
    const edges: Edge[] = [{ from: 'fanout:source→process', to: 'source' }]
    const runId = await setupGraphAndRun(nodes, edges)

    // Complete layer 0
    await completeTask('source', edges, runId)

    const mockLoader = createMockLoader({
      name: 'test-graph',
      stateSchema: {},
      nodes: [],
      edges,
      condEdges: [],
      fanOuts: [
        {
          nodeName: 'fanout:source→process',
          from: 'source',
          templateNode: 'process',
          fn: () => {
            throw new Error('fanout evaluation failed')
          },
        },
      ],
    })

    await expect(next.findNext(runId, { loader: mockLoader })).rejects.toThrow(
      'fanout evaluation failed',
    )

    const task = await workflowService.getTask('fanout:source→process', runId)
    expect(task?.status).toBe('failed')
    expect(task?.error).toBe('fanout evaluation failed')
  })

  it('throws when node is not found in graph definition', async () => {
    // Create a graph where the ready task's node name is missing from the graph's node list
    const nodes: Node[] = [{ name: 'a', description: 'Node a', instructions: 'Do a' }]
    const edges: Edge[] = []
    // We set up a run with node 'a', then manipulate the graph to remove it
    const runId = await setupGraphAndRun(nodes, edges)

    // Overwrite the graph with empty nodes
    const tmpDir = process.cwd()
    await fs.writeFile(
      path.join(tmpDir, '.dagman/graphs/test-graph.json'),
      JSON.stringify({ name: 'test-graph', edges: [], nodes: [] }, null, 2),
    )

    await expect(next.findNext(runId)).rejects.toThrow("node 'a' not found in graph")
  })

  it('renders instructions with self variable references', async () => {
    const nodes: Node[] = [{ name: 'a', description: 'Node a', instructions: 'Result: {{output}}' }]
    const edges: Edge[] = []
    const runId = await setupGraphAndRun(nodes, edges)

    // Set a node channel that instructions will reference
    await workflowService.setChannel('a.output', 'hello-world', runId)

    const result = await next.findNext(runId)
    expect(result).not.toBeNull()
    expect(result!.instructions).toBe('Result: hello-world')
  })

  it('renders instructions with global variable references', async () => {
    const nodes: Node[] = [
      { name: 'a', description: 'Node a', instructions: 'Global: {{global.config}}' },
    ]
    const edges: Edge[] = []
    const runId = await setupGraphAndRun(nodes, edges)

    // Set a global channel
    await workflowService.setChannel('_global.config', 'production', runId)

    const result = await next.findNext(runId)
    expect(result).not.toBeNull()
    expect(result!.instructions).toBe('Global: production')
  })

  it('renders instructions with node variable references', async () => {
    const nodes: Node[] = [
      { name: 'a', description: 'Node a', instructions: '' },
      { name: 'b', description: 'Node b', instructions: 'Upstream: {{a.result}}' },
    ]
    const edges: Edge[] = [{ from: 'b', to: 'a' }]
    const runId = await setupGraphAndRun(nodes, edges)

    // Set a node channel for 'a' and complete 'a'
    await workflowService.setChannel('a.result', 'upstream-data', runId)
    await completeTask('a', edges, runId)

    const result = await next.findNext(runId)
    expect(result).not.toBeNull()
    expect(result!.task.nodeId).toBe('b')
    expect(result!.instructions).toBe('Upstream: upstream-data')
  })

  it('throws on unresolved variable references in instructions', async () => {
    const nodes: Node[] = [
      { name: 'a', description: 'Node a', instructions: 'Missing: {{nonexistent}}' },
    ]
    const edges: Edge[] = []
    const runId = await setupGraphAndRun(nodes, edges)

    await expect(next.findNext(runId)).rejects.toThrow(
      'unresolved variables in node instructions: {{nonexistent}}',
    )
  })

  it('handles agent/collect nodes without executing them', async () => {
    // 'collect' kind nodes are not handled by executeWorkflowNode/executeCondEdge/executeFanOutNode
    // They should just pass through to buildResult
    const nodes: Node[] = [
      { name: 'a', description: 'Node a', instructions: '' },
      {
        name: 'collect:a',
        description: 'Collect a',
        instructions: '',
        kind: 'collect',
        parentNodeId: 'a',
      },
      { name: 'b', description: 'Node b', instructions: 'Do b' },
    ]
    const edges: Edge[] = [
      { from: 'collect:a', to: 'a' },
      { from: 'b', to: 'collect:a' },
    ]
    const runId = await setupGraphAndRun(nodes, edges)

    // Complete layer 0
    await completeTask('a', edges, runId)

    // collect:a is now ready (layer 1)
    const result = await next.findNext(runId)
    expect(result).not.toBeNull()
    expect(result!.task.nodeId).toBe('collect:a')
    // collect nodes don't get auto-executed; they stay ready
    expect(result!.task.status).toBe('ready')
  })
})

// ===== findAllNext Tests =====

describe('findAllNext (integration)', () => {
  afterEach(async () => {
    await cleanupTmpDir()
  })

  it('returns empty array when no tasks are ready', async () => {
    const nodes: Node[] = [{ name: 'a', description: 'Node a', instructions: 'Do a' }]
    const edges: Edge[] = []
    const runId = await setupGraphAndRun(nodes, edges)

    // Start the only task so it's not 'ready'
    await workflowService.startTask('a', runId)

    const results = await next.findAllNext(runId)
    expect(results).toHaveLength(0)
  })

  it('returns all ready tasks sorted alphabetically', async () => {
    const nodes: Node[] = [
      { name: 'a', description: 'Node a', instructions: '' },
      { name: 'b', description: 'Node b', instructions: '' },
      { name: 'c', description: 'Node c', instructions: '' },
    ]
    const edges: Edge[] = []
    const runId = await setupGraphAndRun(nodes, edges)

    const results = await next.findAllNext(runId)
    expect(results).toHaveLength(3)
    expect(results.map((r) => r.task.nodeId)).toEqual(['a', 'b', 'c'])
  })

  it('returns empty array when all tasks are filtered by condEdge', async () => {
    const nodes: Node[] = [
      { name: 'classify', description: 'Classify', instructions: '' },
      { name: 'cond:classify→route', description: 'Cond', instructions: '', kind: 'cond' },
      { name: 'tool', description: 'Tool', instructions: '' },
      { name: 'chat', description: 'Chat', instructions: '' },
    ]
    const edges: Edge[] = [
      { from: 'cond:classify→route', to: 'classify' },
      { from: 'tool', to: 'cond:classify→route' },
      { from: 'chat', to: 'cond:classify→route' },
    ]
    const runId = await setupGraphAndRun(nodes, edges)

    // Complete layers 0 and 1 without setting cond channel
    await completeTask('classify', edges, runId)
    await completeTask('cond:classify→route', edges, runId)

    const results = await next.findAllNext(runId)
    expect(results).toHaveLength(0)
  })

  it('returns only cond-passing tasks', async () => {
    const nodes: Node[] = [
      { name: 'classify', description: 'Classify', instructions: '' },
      { name: 'cond:classify→route', description: 'Cond', instructions: '', kind: 'cond' },
      { name: 'tool', description: 'Tool', instructions: 'Use tool' },
      { name: 'chat', description: 'Chat', instructions: 'Use chat' },
    ]
    const edges: Edge[] = [
      { from: 'cond:classify→route', to: 'classify' },
      { from: 'tool', to: 'cond:classify→route' },
      { from: 'chat', to: 'cond:classify→route' },
    ]
    const runId = await setupGraphAndRun(nodes, edges)

    // Complete layers 0 and 1, set cond to 'chat'
    await completeTask('classify', edges, runId)
    await completeTask('cond:classify→route', edges, runId)
    await workflowService.setChannel(condChannelName('cond:classify→route'), 'chat', runId)

    const results = await next.findAllNext(runId)
    expect(results).toHaveLength(1)
    expect(results[0]!.task.nodeId).toBe('chat')
  })

  it('executes user nodes for each task', async () => {
    const nodes: Node[] = [
      { name: 'a', description: 'Node a', instructions: 'Do a', kind: 'user' },
      { name: 'b', description: 'Node b', instructions: 'Do b', kind: 'user' },
    ]
    const edges: Edge[] = []
    const runId = await setupGraphAndRun(nodes, edges)

    const calledNodes: string[] = []
    const mockLoader = createMockLoader({
      name: 'test-graph',
      stateSchema: {},
      nodes: [
        {
          name: 'a',
          fn: () => {
            calledNodes.push('a')
          },
        },
        {
          name: 'b',
          fn: () => {
            calledNodes.push('b')
          },
        },
      ],
      edges: [],
      condEdges: [],
      fanOuts: [],
    })

    const results = await next.findAllNext(runId, { loader: mockLoader })
    expect(results).toHaveLength(2)
    expect(calledNodes.sort()).toEqual(['a', 'b'])
    // Verify execution persisted via state
    const state = await workflowService.loadState(runId)
    expect(state.currentRecord.tasks.every((t) => t.status === 'success')).toBe(true)
  })

  it('executes multiple node kinds in one call', async () => {
    const nodes: Node[] = [
      { name: 'source', description: 'Source', instructions: '' },
      {
        name: 'fanout:source→process',
        description: 'FanOut',
        instructions: '',
        kind: 'fanout',
      },
    ]
    const edges: Edge[] = [{ from: 'fanout:source→process', to: 'source' }]
    const runId = await setupGraphAndRun(nodes, edges)

    // Complete layer 0
    await completeTask('source', edges, runId)

    const mockLoader = createMockLoader({
      name: 'test-graph',
      stateSchema: {},
      nodes: [],
      edges,
      condEdges: [],
      fanOuts: [
        {
          nodeName: 'fanout:source→process',
          from: 'source',
          templateNode: 'process',
          fn: () => ['x', 'y'],
        },
      ],
    })

    const results = await next.findAllNext(runId, { loader: mockLoader })
    expect(results).toHaveLength(1)
    expect(results[0]!.task.nodeId).toBe('fanout:source→process')
    // Verify fanout was executed
    const state = await workflowService.loadState(runId)
    const fanoutCh = state.channels[fanoutChannelName('fanout:source→process')]
    expect(fanoutCh!.value).toEqual(['x', 'y'])
  })

  it('returns results with rendered instructions for each task', async () => {
    const nodes: Node[] = [
      { name: 'a', description: 'Node a', instructions: 'Task {{self_key}}' },
      { name: 'b', description: 'Node b', instructions: 'Other {{global.val}}' },
    ]
    const edges: Edge[] = []
    const runId = await setupGraphAndRun(nodes, edges)

    await workflowService.setChannel('a.self_key', 'my-task', runId)
    await workflowService.setChannel('_global.val', 'global-val', runId)

    const results = await next.findAllNext(runId)
    expect(results).toHaveLength(2)
    expect(results.find((r) => r.task.nodeId === 'a')!.instructions).toBe('Task my-task')
    expect(results.find((r) => r.task.nodeId === 'b')!.instructions).toBe('Other global-val')
  })

  it('throws when node not found in graph', async () => {
    const nodes: Node[] = [{ name: 'a', description: 'A', instructions: '' }]
    const edges: Edge[] = []
    const runId = await setupGraphAndRun(nodes, edges)

    // Overwrite graph with empty nodes
    const tmpDir = process.cwd()
    await fs.writeFile(
      path.join(tmpDir, '.dagman/graphs/test-graph.json'),
      JSON.stringify({ name: 'test-graph', edges: [], nodes: [] }, null, 2),
    )

    await expect(next.findAllNext(runId)).rejects.toThrow("node 'a' not found in graph")
  })

  it('executes cond nodes for each task in findAllNext', async () => {
    const nodes: Node[] = [
      { name: 'start', description: 'Start', instructions: '' },
      { name: 'cond:start→branch', description: 'Cond', instructions: '', kind: 'cond' },
      { name: 'branch-a', description: 'Branch A', instructions: '' },
    ]
    const edges: Edge[] = [
      { from: 'cond:start→branch', to: 'start' },
      { from: 'branch-a', to: 'cond:start→branch' },
    ]
    const runId = await setupGraphAndRun(nodes, edges)

    // Complete layer 0
    await completeTask('start', edges, runId)

    // cond:start→branch is ready (layer 1)
    const mockLoader = createMockLoader({
      name: 'test-graph',
      stateSchema: {},
      nodes: [],
      edges,
      condEdges: [
        {
          nodeName: 'cond:start→branch',
          from: 'start',
          targets: ['branch-a'],
          fn: () => 'branch-a',
        },
      ],
      fanOuts: [],
    })

    const results = await next.findAllNext(runId, { loader: mockLoader })
    expect(results).toHaveLength(1)
    expect(results[0]!.task.nodeId).toBe('cond:start→branch')
    // Verify cond was executed via state
    const state = await workflowService.loadState(runId)
    const condCh = state.channels[condChannelName('cond:start→branch')]
    expect(condCh!.value).toBe('branch-a')
  })
})

// ===== resolveRunContext edge cases =====

describe('resolveRunContext error paths', () => {
  afterEach(async () => {
    await cleanupTmpDir()
  })

  it('findNext throws when run has no graph binding', async () => {
    initTmpDir()
    // Create a run without a graph
    const info = await runService.createRun('orphan-run', undefined, true)

    await expect(next.findNext(info.id)).rejects.toThrow('current run is not bound to a graph')
  })

  it('findAllNext throws when run has no graph binding', async () => {
    initTmpDir()
    const info = await runService.createRun('orphan-run2', undefined, true)

    await expect(next.findAllNext(info.id)).rejects.toThrow('current run is not bound to a graph')
  })
})
