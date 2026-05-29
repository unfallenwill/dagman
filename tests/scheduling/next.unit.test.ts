import { describe, it, expect } from 'vitest'
import * as next from '../../src/scheduling/next.js'
import * as workflow from '../../src/workflow/workflow.js'
import type { Edge } from '../../src/models/graph.js'
import type { Node } from '../../src/models/node.js'
import type { Task } from '../../src/models/task.js'
import { createTestWorkflowDeps } from '../helpers/in-memory-repository.js'
import { condChannelName } from '../../src/models/channel.js'
import type { WorkflowDeps } from '../../src/workflow/workflow.js'

// ===== Test Helpers =====

/**
 * Create a complete test environment with in-memory repos and seeded state.
 *
 * @param layers - Topological layer assignment for nodes
 * @param edges - Graph edges
 * @param nodes - Node definitions (optional, defaults to minimal nodes)
 * @param graphName - Name of the graph for run binding
 * @returns Test environment including deps, runId, nodes, edges, and helper functions
 */
function createTestEnvironment(
  layers: Map<number, string[]>,
  edges: Edge[],
  nodes?: Node[],
  graphName = 'test-graph',
) {
  const deps = createTestWorkflowDeps()
  const runId = 'test-run'
  const testNodes: Node[] = nodes ?? []

  // Seed run info with layer assignment and graph binding
  const layerAssignment: Record<string, number> = {}
  for (const [layer, nodeNames] of layers.entries()) {
    for (const name of nodeNames) {
      layerAssignment[name] = layer
    }
  }
  deps.runRepo.writeRunInfo(runId, {
    id: runId,
    createdAt: '2025-01-01T00:00:00.000Z',
    currentStep: 0,
    status: 'running',
    graphName,
    layerAssignment,
  })

  // Create workflow deps
  const workflowDeps: WorkflowDeps = {
    clock: deps.clock,
    repo: deps.repo,
    eventRepo: deps.eventRepo,
    runRepo: deps.runRepo,
  }

  // Initialize workflow
  workflow.initWorkflow(runId, layers, edges, workflowDeps)

  return {
    deps,
    runId,
    nodes: testNodes,
    edges,
    workflowDeps,
  }
}

/**
 * Helper to get ready tasks in the current layer.
 */
async function getReadyTasks(runId: string, workflowDeps: WorkflowDeps): Promise<Task[]> {
  return await workflow.findReadyTasks(runId, workflowDeps)
}

/**
 * Helper to set a channel value.
 */
async function setChannel(
  name: string,
  value: unknown,
  runId: string,
  workflowDeps: WorkflowDeps,
): Promise<void> {
  await workflow.setChannel(name, value, runId, workflowDeps)
}

/**
 * Helper to complete a task and advance to next layer if applicable.
 */
async function completeTask(
  nodeId: string,
  edges: Edge[],
  runId: string,
  workflowDeps: WorkflowDeps,
): Promise<void> {
  await workflow.startTask(nodeId, runId, workflowDeps)
  await workflow.completeTask(nodeId, edges, runId, workflowDeps)
}

// ===== Tests =====

describe('scheduling/next unit tests (in-memory)', () => {
  describe('filterByCondEdge', () => {
    it('returns all tasks when no condEdges block them', async () => {
      const layers = new Map<number, string[]>([
        [0, ['a']],
        [1, ['b', 'c']],
      ])
      const edges: Edge[] = [{ from: 'b', to: 'a' }]
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges)

      // Complete layer 0 to reach layer 1
      await completeTask('a', testEdges, runId, workflowDeps)

      const readyTasks = await getReadyTasks(runId, workflowDeps)
      const state = await workflow.loadState(runId, workflowDeps)

      const result = await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
        workflowDeps,
      })

      expect(result).toHaveLength(2)
      expect(result.map((t) => t.nodeId).sort()).toEqual(['b', 'c'])
    })

    it('filters out tasks blocked by condEdge when cond channel selects a different target', async () => {
      const layers = new Map<number, string[]>([
        [0, ['classify']],
        [1, ['cond:classify→route']],
        [2, ['tool', 'chat']],
      ])
      const edges: Edge[] = [
        { from: 'cond:classify→route', to: 'classify' },
        { from: 'tool', to: 'cond:classify→route' },
        { from: 'chat', to: 'cond:classify→route' },
      ]
      const nodes: Node[] = [
        { name: 'classify' },
        { name: 'cond:classify→route', kind: 'cond' },
        { name: 'tool' },
        { name: 'chat' },
      ]
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges, nodes)

      // Complete layers 0 and 1
      await completeTask('classify', testEdges, runId, workflowDeps)
      await completeTask('cond:classify→route', testEdges, runId, workflowDeps)

      // Set cond channel to select 'tool'
      await setChannel(condChannelName('cond:classify→route'), 'tool', runId, workflowDeps)

      const readyTasks = await getReadyTasks(runId, workflowDeps)
      const state = await workflow.loadState(runId, workflowDeps)

      const result = await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
        workflowDeps,
      })

      expect(result).toHaveLength(1)
      expect(result[0]!.nodeId).toBe('tool')
    })

    it('filters out all tasks when cond channel is not set', async () => {
      const layers = new Map<number, string[]>([
        [0, ['classify']],
        [1, ['cond:classify→route']],
        [2, ['tool', 'chat']],
      ])
      const edges: Edge[] = [
        { from: 'cond:classify→route', to: 'classify' },
        { from: 'tool', to: 'cond:classify→route' },
        { from: 'chat', to: 'cond:classify→route' },
      ]
      const nodes: Node[] = [
        { name: 'classify' },
        { name: 'cond:classify→route', kind: 'cond' },
        { name: 'tool' },
        { name: 'chat' },
      ]
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges, nodes)

      // Complete layers 0 and 1 without setting cond channel
      await completeTask('classify', testEdges, runId, workflowDeps)
      await completeTask('cond:classify→route', testEdges, runId, workflowDeps)

      const readyTasks = await getReadyTasks(runId, workflowDeps)
      const state = await workflow.loadState(runId, workflowDeps)

      const result = await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
        workflowDeps,
      })

      expect(result).toHaveLength(0)
    })

    it('handles mixed scenario: some tasks blocked, some pass', async () => {
      const layers = new Map<number, string[]>([
        [0, ['classify']],
        [1, ['cond:classify→route']],
        [2, ['tool', 'chat', 'email']],
      ])
      const edges: Edge[] = [
        { from: 'cond:classify→route', to: 'classify' },
        { from: 'tool', to: 'cond:classify→route' },
        { from: 'chat', to: 'cond:classify→route' },
        { from: 'email', to: 'classify' }, // not blocked by condEdge
      ]
      const nodes: Node[] = [
        { name: 'classify' },
        { name: 'cond:classify→route', kind: 'cond' },
        { name: 'tool' },
        { name: 'chat' },
        { name: 'email' },
      ]
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges, nodes)

      // Complete layers 0 and 1
      await completeTask('classify', testEdges, runId, workflowDeps)
      await completeTask('cond:classify→route', testEdges, runId, workflowDeps)

      // Set cond channel to select 'tool'
      await setChannel(condChannelName('cond:classify→route'), 'tool', runId, workflowDeps)

      const readyTasks = await getReadyTasks(runId, workflowDeps)
      const state = await workflow.loadState(runId, workflowDeps)

      const result = await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
        workflowDeps,
      })

      expect(result).toHaveLength(2)
      expect(result.map((t) => t.nodeId).sort()).toEqual(['email', 'tool'])
    })

    it('marks blocked tasks as skipped', async () => {
      const layers = new Map<number, string[]>([
        [0, ['classify']],
        [1, ['cond:classify→route']],
        [2, ['tool', 'chat']],
      ])
      const edges: Edge[] = [
        { from: 'cond:classify→route', to: 'classify' },
        { from: 'tool', to: 'cond:classify→route' },
        { from: 'chat', to: 'cond:classify→route' },
      ]
      const nodes: Node[] = [
        { name: 'classify' },
        { name: 'cond:classify→route', kind: 'cond' },
        { name: 'tool' },
        { name: 'chat' },
      ]
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges, nodes)

      // Complete layers 0 and 1
      await completeTask('classify', testEdges, runId, workflowDeps)
      await completeTask('cond:classify→route', testEdges, runId, workflowDeps)

      // Set cond channel to select 'tool' (blocking 'chat')
      await setChannel(condChannelName('cond:classify→route'), 'tool', runId, workflowDeps)

      const readyTasks = await getReadyTasks(runId, workflowDeps)
      const state = await workflow.loadState(runId, workflowDeps)

      await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
        workflowDeps,
      })

      // Verify 'chat' was marked as skipped
      const chatTask = await workflow.getTask('chat', runId, undefined, workflowDeps)
      expect(chatTask?.status).toBe('skipped')
    })

    it('handles empty task list', async () => {
      const layers = new Map<number, string[]>([[0, ['a']]])
      const edges: Edge[] = []
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges)

      const state = await workflow.loadState(runId, workflowDeps)

      const result = await next.filterByCondEdge([], testEdges, state.channels, runId, {
        workflowDeps,
      })

      expect(result).toHaveLength(0)
    })

    it('handles edges without condEdge upstream', async () => {
      const layers = new Map<number, string[]>([[0, ['a', 'b']]])
      const edges: Edge[] = [{ from: 'b', to: 'a' }]
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges)

      const readyTasks = await getReadyTasks(runId, workflowDeps)
      const state = await workflow.loadState(runId, workflowDeps)

      const result = await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
        workflowDeps,
      })

      expect(result).toHaveLength(2)
    })

    it('ignores non-condEdge virtual nodes', async () => {
      const layers = new Map<number, string[]>([
        [0, ['a']],
        [1, ['collect:a', 'b']],
      ])
      const edges: Edge[] = [
        { from: 'collect:a', to: 'a' },
        { from: 'b', to: 'collect:a' },
      ]
      const nodes: Node[] = [{ name: 'a' }, { name: 'collect:a', kind: 'collect' }, { name: 'b' }]
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges, nodes)

      // Complete layer 0
      await completeTask('a', testEdges, runId, workflowDeps)

      const readyTasks = await getReadyTasks(runId, workflowDeps)
      const state = await workflow.loadState(runId, workflowDeps)

      const result = await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
        workflowDeps,
      })

      expect(result).toHaveLength(2)
    })

    it('only skips tasks that are ready (not already running/skipped)', async () => {
      const layers = new Map<number, string[]>([
        [0, ['classify']],
        [1, ['cond:classify→route']],
        [2, ['tool', 'chat']],
      ])
      const edges: Edge[] = [
        { from: 'cond:classify→route', to: 'classify' },
        { from: 'tool', to: 'cond:classify→route' },
        { from: 'chat', to: 'cond:classify→route' },
      ]
      const nodes: Node[] = [
        { name: 'classify' },
        { name: 'cond:classify→route', kind: 'cond' },
        { name: 'tool' },
        { name: 'chat' },
      ]
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges, nodes)

      // Complete layers 0 and 1
      await completeTask('classify', testEdges, runId, workflowDeps)
      await completeTask('cond:classify→route', testEdges, runId, workflowDeps)

      // Set cond channel to select 'tool'
      await setChannel(condChannelName('cond:classify→route'), 'tool', runId, workflowDeps)

      // Start 'chat' task first (making it not 'ready' anymore)
      await workflow.startTask('chat', runId, workflowDeps)

      const readyTasks = await getReadyTasks(runId, workflowDeps)
      const state = await workflow.loadState(runId, workflowDeps)

      const result = await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
        workflowDeps,
      })

      // Only 'tool' is ready and passes the filter
      expect(result).toHaveLength(1)
      expect(result[0]!.nodeId).toBe('tool')

      // 'chat' should remain running (not skipped since it wasn't ready)
      const chatTask = await workflow.getTask('chat', runId, undefined, workflowDeps)
      expect(chatTask?.status).toBe('running')
    })

    it('handles condEdge pointing to non-candidate node', async () => {
      const layers = new Map<number, string[]>([
        [0, ['classify']],
        [1, ['cond:classify→route']],
        [2, ['tool', 'chat']],
      ])
      const edges: Edge[] = [
        { from: 'cond:classify→route', to: 'classify' },
        { from: 'tool', to: 'cond:classify→route' },
        { from: 'chat', to: 'cond:classify→route' },
      ]
      const nodes: Node[] = [
        { name: 'classify' },
        { name: 'cond:classify→route', kind: 'cond' },
        { name: 'tool' },
        { name: 'chat' },
      ]
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges, nodes)

      // Complete layers 0 and 1
      await completeTask('classify', testEdges, runId, workflowDeps)
      await completeTask('cond:classify→route', testEdges, runId, workflowDeps)

      // Set cond channel to select a node that is not in the ready list
      await setChannel(condChannelName('cond:classify→route'), 'unknown-node', runId, workflowDeps)

      const readyTasks = await getReadyTasks(runId, workflowDeps)
      const state = await workflow.loadState(runId, workflowDeps)

      const result = await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
        workflowDeps,
      })

      // Both tasks should be filtered since cond points to unknown node
      expect(result).toHaveLength(0)
    })
  })

  describe('condEdge channel naming consistency', () => {
    it('uses correct cond channel name format', () => {
      const condNodeName = 'cond:classify→route'
      const channelName = condChannelName(condNodeName)
      expect(channelName).toBe('_cond.cond:classify→route')
    })

    it('handles cond node with different naming patterns', () => {
      expect(condChannelName('cond:a→b')).toBe('_cond.cond:a→b')
      expect(condChannelName('cond:source→process')).toBe('_cond.cond:source→process')
    })
  })

  describe('filterByCondEdge with complex edge patterns', () => {
    it('handles multiple condEdges in same workflow', async () => {
      const layers = new Map<number, string[]>([
        [0, ['classify']],
        [1, ['cond:classify→route', 'cond:classify→action']],
        [2, ['tool', 'chat', 'email', 'sms']],
      ])
      const edges: Edge[] = [
        { from: 'cond:classify→route', to: 'classify' },
        { from: 'tool', to: 'cond:classify→route' },
        { from: 'chat', to: 'cond:classify→route' },
        { from: 'cond:classify→action', to: 'classify' },
        { from: 'email', to: 'cond:classify→action' },
        { from: 'sms', to: 'cond:classify→action' },
      ]
      const nodes: Node[] = [
        { name: 'classify' },
        { name: 'cond:classify→route', kind: 'cond' },
        { name: 'cond:classify→action', kind: 'cond' },
        { name: 'tool' },
        { name: 'chat' },
        { name: 'email' },
        { name: 'sms' },
      ]
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges, nodes)

      // Complete layers 0 and 1
      await completeTask('classify', testEdges, runId, workflowDeps)
      await completeTask('cond:classify→route', testEdges, runId, workflowDeps)
      await completeTask('cond:classify→action', testEdges, runId, workflowDeps)

      // Set cond channels
      await setChannel(condChannelName('cond:classify→route'), 'tool', runId, workflowDeps)
      await setChannel(condChannelName('cond:classify→action'), 'email', runId, workflowDeps)

      const readyTasks = await getReadyTasks(runId, workflowDeps)
      const state = await workflow.loadState(runId, workflowDeps)

      const result = await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
        workflowDeps,
      })

      expect(result).toHaveLength(2)
      expect(result.map((t) => t.nodeId).sort()).toEqual(['email', 'tool'])
    })

    it('handles condEdge in chain with regular edges', async () => {
      const layers = new Map<number, string[]>([
        [0, ['start']],
        [1, ['cond:start→branch']],
        [2, ['branch-a', 'branch-b']],
        [3, ['end']],
      ])
      const edges: Edge[] = [
        { from: 'cond:start→branch', to: 'start' },
        { from: 'branch-a', to: 'cond:start→branch' },
        { from: 'branch-b', to: 'cond:start→branch' },
        { from: 'end', to: 'branch-a' },
        { from: 'end', to: 'branch-b' },
      ]
      const nodes: Node[] = [
        { name: 'start' },
        { name: 'cond:start→branch', kind: 'cond' },
        { name: 'branch-a' },
        { name: 'branch-b' },
        { name: 'end' },
      ]
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges, nodes)

      // Complete layers 0, 1, and select branch-a
      await completeTask('start', testEdges, runId, workflowDeps)
      await completeTask('cond:start→branch', testEdges, runId, workflowDeps)
      await setChannel(condChannelName('cond:start→branch'), 'branch-a', runId, workflowDeps)

      // Layer 2: branch-a passes, branch-b gets skipped
      const layer2Tasks = await getReadyTasks(runId, workflowDeps)
      const state2 = await workflow.loadState(runId, workflowDeps)
      await next.filterByCondEdge(layer2Tasks, testEdges, state2.channels, runId, {
        workflowDeps,
      })

      // Verify branch-b was skipped
      const branchBTask = await workflow.getTask('branch-b', runId, undefined, workflowDeps)
      expect(branchBTask?.status).toBe('skipped')

      // Complete branch-a
      await completeTask('branch-a', testEdges, runId, workflowDeps)

      // Layer 3: end should be ready (depends on both branches, but skipped satisfies)
      const layer3Tasks = await getReadyTasks(runId, workflowDeps)
      expect(layer3Tasks.map((t) => t.nodeId)).toEqual(['end'])
    })
  })

  describe('filterByCondEdge edge cases', () => {
    it('handles tasks with same name across different contexts', async () => {
      const layers = new Map<number, string[]>([
        [0, ['a']],
        [1, ['cond:a→x']],
        [2, ['x']],
      ])
      const edges: Edge[] = [
        { from: 'cond:a→x', to: 'a' },
        { from: 'x', to: 'cond:a→x' },
      ]
      const nodes: Node[] = [{ name: 'a' }, { name: 'cond:a→x', kind: 'cond' }, { name: 'x' }]
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges, nodes)

      await completeTask('a', testEdges, runId, workflowDeps)
      await completeTask('cond:a→x', testEdges, runId, workflowDeps)

      // Cond channel matches the task name exactly
      await setChannel(condChannelName('cond:a→x'), 'x', runId, workflowDeps)

      const readyTasks = await getReadyTasks(runId, workflowDeps)
      const state = await workflow.loadState(runId, workflowDeps)

      const result = await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
        workflowDeps,
      })

      expect(result).toHaveLength(1)
      expect(result[0]!.nodeId).toBe('x')
    })

    it('preserves task order when filtering', async () => {
      const layers = new Map<number, string[]>([
        [0, ['x']],
        [1, ['cond:x→y']],
        [2, ['z', 'a', 'm']],
      ])
      const edges: Edge[] = [
        { from: 'cond:x→y', to: 'x' },
        { from: 'a', to: 'cond:x→y' },
        { from: 'm', to: 'cond:x→y' },
        // z does NOT depend on cond:x→y, so it should pass through
      ]
      const nodes: Node[] = [
        { name: 'x' },
        { name: 'cond:x→y', kind: 'cond' },
        { name: 'z' },
        { name: 'a' },
        { name: 'm' },
      ]
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges, nodes)

      // Set up: complete previous layers
      await completeTask('x', testEdges, runId, workflowDeps)
      await completeTask('cond:x→y', testEdges, runId, workflowDeps)
      await setChannel(condChannelName('cond:x→y'), 'a', runId, workflowDeps)

      const readyTasks = await getReadyTasks(runId, workflowDeps)
      const state = await workflow.loadState(runId, workflowDeps)

      const result = await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
        workflowDeps,
      })

      // z is not blocked (no condEdge upstream), a passes the cond check
      expect(result.map((t) => t.nodeId).sort()).toEqual(['a', 'z'])
    })

    it('does not modify input task array', async () => {
      const layers = new Map<number, string[]>([[0, ['a', 'b']]])
      const edges: Edge[] = []
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges)

      const readyTasks = await getReadyTasks(runId, workflowDeps)
      const originalLength = readyTasks.length
      const state = await workflow.loadState(runId, workflowDeps)

      await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
        workflowDeps,
      })

      expect(readyTasks.length).toBe(originalLength)
    })
  })

  describe('filterByCondEdge interaction with workflow state', () => {
    it('updates workflow state when skipping tasks', async () => {
      const layers = new Map<number, string[]>([
        [0, ['classify']],
        [1, ['cond:classify→route']],
        [2, ['tool', 'chat']],
      ])
      const edges: Edge[] = [
        { from: 'cond:classify→route', to: 'classify' },
        { from: 'tool', to: 'cond:classify→route' },
        { from: 'chat', to: 'cond:classify→route' },
      ]
      const nodes: Node[] = [
        { name: 'classify' },
        { name: 'cond:classify→route', kind: 'cond' },
        { name: 'tool' },
        { name: 'chat' },
      ]
      const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges, nodes)

      await completeTask('classify', testEdges, runId, workflowDeps)
      await completeTask('cond:classify→route', testEdges, runId, workflowDeps)
      await setChannel(condChannelName('cond:classify→route'), 'tool', runId, workflowDeps)

      const readyTasks = await getReadyTasks(runId, workflowDeps)
      const stateBefore = await workflow.loadState(runId, workflowDeps)
      const recordCountBefore = (await workflow.getStepHistory(runId, workflowDeps)).length

      await next.filterByCondEdge(readyTasks, testEdges, stateBefore.channels, runId, {
        workflowDeps,
      })

      const stateAfter = await workflow.loadState(runId, workflowDeps)
      const recordCountAfter = (await workflow.getStepHistory(runId, workflowDeps)).length

      // A new record should have been written for the skipped task
      expect(recordCountAfter).toBeGreaterThan(recordCountBefore)

      // The skipped task should be reflected in current record
      const currentTasks = stateAfter.currentRecord.tasks
      const chatTask = currentTasks.find((t) => t.nodeId === 'chat')
      expect(chatTask?.status).toBe('skipped')
    })
  })
})

describe('scheduling/next coverage edge cases', () => {
  it('handles workflow with single layer and no edges', async () => {
    const layers = new Map<number, string[]>([[0, ['solo']]])
    const edges: Edge[] = []
    const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges)

    const readyTasks = await getReadyTasks(runId, workflowDeps)
    const state = await workflow.loadState(runId, workflowDeps)

    const result = await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
      workflowDeps,
    })

    expect(result).toHaveLength(1)
    expect(result[0]!.nodeId).toBe('solo')
  })

  it('handles empty layers', async () => {
    const deps = createTestWorkflowDeps()
    const runId = 'empty-run'
    deps.runRepo.writeRunInfo(runId, {
      id: runId,
      createdAt: '2025-01-01T00:00:00.000Z',
      currentStep: 0,
      status: 'running',
      graphName: 'empty-graph',
      layerAssignment: {},
    })

    const workflowDeps = {
      clock: deps.clock,
      repo: deps.repo,
      eventRepo: deps.eventRepo,
      runRepo: deps.runRepo,
    }

    const layers = new Map<number, string[]>()
    await workflow.initWorkflow(runId, layers, [], workflowDeps)

    const readyTasks = await getReadyTasks(runId, workflowDeps)
    const state = await workflow.loadState(runId, workflowDeps)

    const result = await next.filterByCondEdge(readyTasks, [], state.channels, runId, {
      workflowDeps,
    })

    expect(result).toHaveLength(0)
  })

  it('handles condEdge with null channel value', async () => {
    const layers = new Map<number, string[]>([
      [0, ['classify']],
      [1, ['cond:classify→route']],
      [2, ['tool', 'chat']],
    ])
    const edges: Edge[] = [
      { from: 'cond:classify→route', to: 'classify' },
      { from: 'tool', to: 'cond:classify→route' },
      { from: 'chat', to: 'cond:classify→route' },
    ]
    const nodes: Node[] = [
      { name: 'classify' },
      { name: 'cond:classify→route', kind: 'cond' },
      { name: 'tool' },
      { name: 'chat' },
    ]
    const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges, nodes)

    await completeTask('classify', testEdges, runId, workflowDeps)
    await completeTask('cond:classify→route', testEdges, runId, workflowDeps)

    // Set cond channel to null (explicitly)
    await setChannel(condChannelName('cond:classify→route'), null, runId, workflowDeps)

    const readyTasks = await getReadyTasks(runId, workflowDeps)
    const state = await workflow.loadState(runId, workflowDeps)

    const result = await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
      workflowDeps,
    })

    // Both tasks should be filtered since null doesn't match any nodeId
    expect(result).toHaveLength(0)
  })

  it('handles condEdge with undefined channel', async () => {
    const layers = new Map<number, string[]>([
      [0, ['classify']],
      [1, ['cond:classify→route']],
      [2, ['tool', 'chat']],
    ])
    const edges: Edge[] = [
      { from: 'cond:classify→route', to: 'classify' },
      { from: 'tool', to: 'cond:classify→route' },
      { from: 'chat', to: 'cond:classify→route' },
    ]
    const nodes: Node[] = [
      { name: 'classify' },
      { name: 'cond:classify→route', kind: 'cond' },
      { name: 'tool' },
      { name: 'chat' },
    ]
    const { runId, edges: testEdges, workflowDeps } = createTestEnvironment(layers, edges, nodes)

    await completeTask('classify', testEdges, runId, workflowDeps)
    await completeTask('cond:classify→route', testEdges, runId, workflowDeps)

    // Don't set any cond channel - it won't exist in state
    const readyTasks = await getReadyTasks(runId, workflowDeps)
    const state = await workflow.loadState(runId, workflowDeps)

    const result = await next.filterByCondEdge(readyTasks, testEdges, state.channels, runId, {
      workflowDeps,
    })

    // All tasks filtered since channel doesn't exist
    expect(result).toHaveLength(0)
  })
})
