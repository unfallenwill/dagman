import { describe, it, expect } from 'vitest'
import * as workflow from '../../src/domain/workflow/workflow-engine.js'
import { createTestWorkflowDeps } from '../helpers/in-memory-repository.js'
import type { RunInfo } from '../../src/shared/models/superstep.js'
import type { Edge } from '../../src/shared/models/graph.js'

function seedRunInfo(
  runRepo: ReturnType<typeof createTestWorkflowDeps>['runRepo'],
  runId: string,
  layerAssignment: Record<string, number>,
  currentStep = 0,
): void {
  const runInfo: RunInfo = {
    id: runId,
    createdAt: '2025-01-01T00:00:00.000Z',
    currentStep,
    status: 'running',
    layerAssignment,
  }
  runRepo.writeRunInfo(runId, runInfo)
}

describe('workflow unit tests (in-memory)', () => {
  describe('happy path', () => {
    it('initializes, starts, completes a single-node workflow', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'test-run'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      const layers = new Map<number, string[]>([[0, ['a']]])
      const edges: Edge[] = []

      await workflow.initWorkflow(runId, layers, edges, deps)

      // Verify initial state
      const state0 = await workflow.loadState(runId, deps)
      expect(state0.currentRecord.step).toBe(0)
      expect(state0.currentRecord.status).toBe('running')
      expect(state0.currentRecord.tasks).toHaveLength(1)
      expect(state0.currentRecord.tasks[0]!.nodeId).toBe('a')
      expect(state0.currentRecord.tasks[0]!.status).toBe('ready')

      // Start task
      const started = await workflow.startTask('a', runId, deps)
      expect(started.status).toBe('running')
      expect(started.startedAt).toBe('2025-01-01T00:00:00.000Z')

      // Complete task
      const { task: completed, advanced } = await workflow.completeTask('a', edges, runId, deps)
      expect(completed.status).toBe('success')
      expect(completed.completedAt).toBe('2025-01-01T00:00:00.000Z')
      expect(advanced).toBe(false) // No next layer

      // Workflow complete
      const isComplete = await workflow.isWorkflowComplete(runId, deps)
      expect(isComplete).toBe(true)
    })

    it('auto-advances through multi-layer workflow', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'multi-run'
      seedRunInfo(deps.runRepo, runId, { a: 0, b: 1, c: 2 })

      const layers = new Map<number, string[]>([
        [0, ['a']],
        [1, ['b']],
        [2, ['c']],
      ])
      const edges: Edge[] = [
        { from: 'b', to: 'a' },
        { from: 'c', to: 'b' },
      ]

      await workflow.initWorkflow(runId, layers, edges, deps)

      // Layer 0: complete 'a' -> auto-advance to layer 1
      await workflow.startTask('a', runId, deps)
      const { advanced: adv1 } = await workflow.completeTask('a', edges, runId, deps)
      expect(adv1).toBe(true)

      // Verify layer 1 tasks
      const tasks1 = await workflow.listTasks(runId, undefined, deps)
      expect(tasks1).toHaveLength(1)
      expect(tasks1[0]!.nodeId).toBe('b')

      // Layer 1: complete 'b' -> auto-advance to layer 2
      await workflow.startTask('b', runId, deps)
      const { advanced: adv2 } = await workflow.completeTask('b', edges, runId, deps)
      expect(adv2).toBe(true)

      // Verify layer 2 tasks
      const tasks2 = await workflow.listTasks(runId, undefined, deps)
      expect(tasks2).toHaveLength(1)
      expect(tasks2[0]!.nodeId).toBe('c')

      // Layer 2: complete 'c' -> workflow done
      await workflow.startTask('c', runId, deps)
      const { advanced: adv3 } = await workflow.completeTask('c', edges, runId, deps)
      expect(adv3).toBe(false)

      const isComplete = await workflow.isWorkflowComplete(runId, deps)
      expect(isComplete).toBe(true)
    })

    it('accumulates edge channel state across steps', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'channel-run'
      seedRunInfo(deps.runRepo, runId, { a: 0, b: 1 })

      const layers = new Map<number, string[]>([
        [0, ['a']],
        [1, ['b']],
      ])
      const edges: Edge[] = [{ from: 'b', to: 'a' }]

      await workflow.initWorkflow(runId, layers, edges, deps)

      // Complete task 'a'
      await workflow.startTask('a', runId, deps)
      await workflow.completeTask('a', edges, runId, deps)

      // Verify edge channel accumulated
      const state = await workflow.loadState(runId, deps)
      const edgeCh = state.channels['edge:a→b']
      expect(edgeCh).toBeDefined()
      expect(edgeCh!.value).toBe('success')
      expect(edgeCh!.version).toBe(1)
    })
  })

  describe('failure and retry', () => {
    it('fails a running task and retries it', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'fail-run'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      const layers = new Map<number, string[]>([[0, ['a']]])
      await workflow.initWorkflow(runId, layers, [], deps)

      // Start and fail
      await workflow.startTask('a', runId, deps)
      const failed = await workflow.failTask('a', runId, 'something broke', deps)
      expect(failed.status).toBe('failed')
      expect(failed.error).toBe('something broke')

      // Verify superstep is failed
      const state = await workflow.loadState(runId, deps)
      expect(state.currentRecord.status).toBe('failed')

      // No ready tasks available
      const readyBefore = await workflow.findReadyTasks(runId, deps)
      expect(readyBefore).toHaveLength(0)

      // Retry
      const retried = await workflow.retryTask('a', runId, deps)
      expect(retried.status).toBe('ready')
      expect(retried.startedAt).toBeUndefined()
      expect(retried.completedAt).toBeUndefined()

      // Ready tasks now available
      const readyAfter = await workflow.findReadyTasks(runId, deps)
      expect(readyAfter).toHaveLength(1)

      // Superstep status is running again
      const stateAfter = await workflow.loadState(runId, deps)
      expect(stateAfter.currentRecord.status).toBe('running')
    })
  })

  describe('skip', () => {
    it('skips a ready task and updates edge channels', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'skip-run'
      seedRunInfo(deps.runRepo, runId, { a: 0, b: 1 })

      const layers = new Map<number, string[]>([
        [0, ['a']],
        [1, ['b']],
      ])
      const edges: Edge[] = [{ from: 'b', to: 'a' }]

      await workflow.initWorkflow(runId, layers, edges, deps)

      const { task: skipped, advanced } = await workflow.skipTask('a', edges, runId, deps)
      expect(skipped.status).toBe('skipped')
      expect(advanced).toBe(true)

      // Edge channel should reflect 'skipped'
      const state = await workflow.loadState(runId, deps)
      const edgeCh = state.channels['edge:a→b']
      expect(edgeCh).toBeDefined()
      expect(edgeCh!.value).toBe('skipped')

      // Workflow should still be considered complete even with skipped tasks
      const isComplete = await workflow.isWorkflowComplete(runId, deps)
      expect(isComplete).toBe(false) // Layer 1 still has tasks
    })

    it('skip completes workflow when it is the last task', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'skip-last-run'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      const layers = new Map<number, string[]>([[0, ['a']]])
      await workflow.initWorkflow(runId, layers, [], deps)

      await workflow.skipTask('a', [], runId, deps)

      const isComplete = await workflow.isWorkflowComplete(runId, deps)
      expect(isComplete).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('throws when loading state for uninitialized workflow', async () => {
      const deps = createTestWorkflowDeps()
      await expect(workflow.loadState('nonexistent', deps)).rejects.toThrow(
        'workflow not initialized',
      )
    })

    it('throws when starting a task not in current superstep', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'edge-run'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      const layers = new Map<number, string[]>([[0, ['a']]])
      await workflow.initWorkflow(runId, layers, [], deps)

      await expect(workflow.startTask('z', runId, deps)).rejects.toThrow(
        "node 'z' not in current superstep",
      )
    })

    it('throws when completing a task that is not running', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'edge-run2'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      const layers = new Map<number, string[]>([[0, ['a']]])
      await workflow.initWorkflow(runId, layers, [], deps)

      // Task is still 'ready', not 'running'
      await expect(workflow.completeTask('a', [], runId, deps)).rejects.toThrow(/cannot complete/)
    })

    it('throws when retrying a task that is not failed', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'edge-run3'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      const layers = new Map<number, string[]>([[0, ['a']]])
      await workflow.initWorkflow(runId, layers, [], deps)

      await expect(workflow.retryTask('a', runId, deps)).rejects.toThrow(/cannot retry/)
    })

    it('handles parallel tasks in same layer', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'parallel-run'
      seedRunInfo(deps.runRepo, runId, { a: 0, b: 0, c: 1 })

      const layers = new Map<number, string[]>([
        [0, ['a', 'b']],
        [1, ['c']],
      ])
      const edges: Edge[] = [
        { from: 'c', to: 'a' },
        { from: 'c', to: 'b' },
      ]

      await workflow.initWorkflow(runId, layers, edges, deps)

      // Start both tasks
      await workflow.startTask('a', runId, deps)
      await workflow.startTask('b', runId, deps)

      // Complete 'a' first — should NOT advance (b still running)
      const { advanced: adv1 } = await workflow.completeTask('a', edges, runId, deps)
      expect(adv1).toBe(false)

      // Complete 'b' — should advance
      const { advanced: adv2 } = await workflow.completeTask('b', edges, runId, deps)
      expect(adv2).toBe(true)

      // Layer 1: 'c'
      const tasks = await workflow.listTasks(runId, undefined, deps)
      expect(tasks).toHaveLength(1)
      expect(tasks[0]!.nodeId).toBe('c')
    })
  })

  describe('event recording', () => {
    it('records events for task lifecycle transitions', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'event-run'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      const layers = new Map<number, string[]>([[0, ['a']]])
      await workflow.initWorkflow(runId, layers, [], deps)

      await workflow.startTask('a', runId, deps)
      await workflow.failTask('a', runId, 'err', deps)
      await workflow.retryTask('a', runId, deps)

      const events = await deps.eventRepo.readEvents(runId)
      expect(events).toHaveLength(3)
      expect(events[0]).toEqual({
        timestamp: '2025-01-01T00:00:00.000Z',
        node: 'a',
        from: 'ready',
        to: 'running',
      })
      expect(events[1]).toEqual({
        timestamp: '2025-01-01T00:00:00.000Z',
        node: 'a',
        from: 'running',
        to: 'failed',
      })
      expect(events[2]).toEqual({
        timestamp: '2025-01-01T00:00:00.000Z',
        node: 'a',
        from: 'failed',
        to: 'ready',
      })
    })
  })

  describe('channel operations', () => {
    it('setChannel and getChannel work with in-memory deps', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'ch-run'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      const layers = new Map<number, string[]>([[0, ['a']]])
      await workflow.initWorkflow(runId, layers, [], deps)

      const ch = await workflow.setChannel('a.output', 'result', runId, deps)
      expect(ch.value).toBe('result')
      expect(ch.version).toBe(1)

      const retrieved = await workflow.getChannel('a.output', runId, deps)
      expect(retrieved?.value).toBe('result')
    })

    it('increments version on repeated setChannel', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'ch-ver-run'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      const layers = new Map<number, string[]>([[0, ['a']]])
      await workflow.initWorkflow(runId, layers, [], deps)

      await workflow.setChannel('a.key', 'v1', runId, deps)
      const ch = await workflow.setChannel('a.key', 'v2', runId, deps)
      expect(ch.version).toBe(2)
      expect(ch.value).toBe('v2')
    })
  })

  describe('step history', () => {
    it('returns all records via getStepHistory', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'hist-run'
      seedRunInfo(deps.runRepo, runId, { a: 0, b: 1 })

      const layers = new Map<number, string[]>([
        [0, ['a']],
        [1, ['b']],
      ])
      const edges: Edge[] = [{ from: 'b', to: 'a' }]

      await workflow.initWorkflow(runId, layers, edges, deps)
      await workflow.startTask('a', runId, deps)
      await workflow.completeTask('a', edges, runId, deps)

      const history = await workflow.getStepHistory(runId, deps)
      // init + start + complete = 3 records minimum
      expect(history.length).toBeGreaterThanOrEqual(3)
    })
  })
})
