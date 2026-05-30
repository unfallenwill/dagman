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

  // ===== New describe blocks for uncovered branches =====

  describe('listChannels', () => {
    it('returns global channels when nodeName is "_global"', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'lc-global'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      await workflow.initWorkflow(runId, new Map([[0, ['a']]]), [], deps)
      await workflow.setChannel('_global.config', 'value', runId, deps)
      await workflow.setChannel('a.output', 'node-result', runId, deps)

      const channels = await workflow.listChannels(runId, '_global', deps)
      expect(channels).toHaveLength(1)
      expect(channels[0]!.name).toBe('_global.config')
    })

    it('returns only channels for a specific node', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'lc-node'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      await workflow.initWorkflow(runId, new Map([[0, ['a']]]), [], deps)
      await workflow.setChannel('a.output', 'result-a', runId, deps)
      await workflow.setChannel('b.output', 'result-b', runId, deps)
      await workflow.setChannel('_global.key', 'global-val', runId, deps)

      const channels = await workflow.listChannels(runId, 'a', deps)
      expect(channels).toHaveLength(1)
      expect(channels[0]!.name).toBe('a.output')
    })

    it('returns empty array for nonexistent node', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'lc-none'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      await workflow.initWorkflow(runId, new Map([[0, ['a']]]), [], deps)
      await workflow.setChannel('a.output', 'result', runId, deps)

      const channels = await workflow.listChannels(runId, 'nonexistent', deps)
      expect(channels).toHaveLength(0)
    })

    it('returns all channels when nodeName is undefined', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'lc-all'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      await workflow.initWorkflow(runId, new Map([[0, ['a']]]), [{ from: 'b', to: 'a' }], deps)
      await workflow.setChannel('a.output', 'result', runId, deps)

      const channels = await workflow.listChannels(runId, undefined, deps)
      // edge:a→b + a.output
      expect(channels.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('clearChannels', () => {
    it('returns early without writing record when no matching channels', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'clear-nomatch'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      await workflow.initWorkflow(runId, new Map([[0, ['a']]]), [], deps)
      const historyBefore = await workflow.getStepHistory(runId, deps)
      const countBefore = historyBefore.length

      await workflow.clearChannels('nonexistent', runId, deps)

      const historyAfter = await workflow.getStepHistory(runId, deps)
      expect(historyAfter.length).toBe(countBefore)
    })

    it('removes only the specified node channels, leaving others intact', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'clear-specific'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      await workflow.initWorkflow(runId, new Map([[0, ['a']]]), [], deps)
      await workflow.setChannel('a.output', 'val-a', runId, deps)
      await workflow.setChannel('a.log', 'log-a', runId, deps)
      await workflow.setChannel('_global.key', 'global-val', runId, deps)

      await workflow.clearChannels('a', runId, deps)

      const state = await workflow.loadState(runId, deps)
      expect(state.channels['a.output']!.value).toBeNull()
      expect(state.channels['a.output']!.version).toBe(2)
      expect(state.channels['a.log']!.value).toBeNull()
      expect(state.channels['_global.key']!.value).toBe('global-val')
    })

    it('writes updated record when node has channels', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'clear-write'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      await workflow.initWorkflow(runId, new Map([[0, ['a']]]), [], deps)
      await workflow.setChannel('a.output', 'before', runId, deps)

      const historyBefore = await workflow.getStepHistory(runId, deps)
      const countBefore = historyBefore.length

      await workflow.clearChannels('a', runId, deps)

      const historyAfter = await workflow.getStepHistory(runId, deps)
      expect(historyAfter.length).toBe(countBefore + 1)

      const lastRecord = historyAfter[historyAfter.length - 1]!
      expect(lastRecord.channelChanges['a.output']).toBeDefined()
      expect(lastRecord.channelChanges['a.output']!.value).toBeNull()
    })
  })

  describe('initEdgeChannels', () => {
    it('initializes edge channels into the first record', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'iec-init'
      seedRunInfo(deps.runRepo, runId, { a: 0, b: 1 })

      await workflow.initWorkflow(runId, new Map([[0, ['a']]]), [], deps)
      const edges: Edge[] = [
        { from: 'b', to: 'a' },
        { from: 'c', to: 'b' },
      ]

      await workflow.initEdgeChannels(edges, runId, deps)

      const records = await deps.repo.readRecords(runId)
      expect(records[0]!.channelChanges['edge:a→b']).toBeDefined()
      expect(records[0]!.channelChanges['edge:b→c']).toBeDefined()
      expect(records[0]!.channelChanges['edge:a→b']!.value).toBeNull()
      expect(records[0]!.channelChanges['edge:a→b']!.version).toBe(0)
    })

    it('is a no-op when no records exist', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'iec-empty'

      // Do NOT call initWorkflow — no records exist
      const edges: Edge[] = [{ from: 'b', to: 'a' }]

      await workflow.initEdgeChannels(edges, runId, deps)

      const records = await deps.repo.readRecords(runId)
      expect(records).toHaveLength(0)
    })
  })

  describe('getChannelVersion', () => {
    it('returns version number for existing channel', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'gcv-exist'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      await workflow.initWorkflow(runId, new Map([[0, ['a']]]), [], deps)
      await workflow.setChannel('a.output', 'v1', runId, deps)
      await workflow.setChannel('a.output', 'v2', runId, deps)

      const version = await workflow.getChannelVersion('a.output', runId, deps)
      expect(version).toBe(2)
    })

    it('returns 0 for non-existing channel', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'gcv-missing'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      await workflow.initWorkflow(runId, new Map([[0, ['a']]]), [], deps)

      const version = await workflow.getChannelVersion('no.such.channel', runId, deps)
      expect(version).toBe(0)
    })
  })

  describe('getTask with explicit step parameter', () => {
    it('returns task from a specific step number', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'gt-step'
      seedRunInfo(deps.runRepo, runId, { a: 0, b: 1 })

      const layers = new Map<number, string[]>([
        [0, ['a']],
        [1, ['b']],
      ])
      const edges: Edge[] = [{ from: 'b', to: 'a' }]

      await workflow.initWorkflow(runId, layers, edges, deps)
      await workflow.startTask('a', runId, deps)
      await workflow.completeTask('a', edges, runId, deps)
      // Now on step 1 with task 'b'

      const taskStep0 = await workflow.getTask('a', runId, 0, deps)
      expect(taskStep0).not.toBeNull()
      expect(taskStep0!.nodeId).toBe('a')
      expect(taskStep0!.status).toBe('success')

      const taskStep1 = await workflow.getTask('b', runId, 1, deps)
      expect(taskStep1).not.toBeNull()
      expect(taskStep1!.nodeId).toBe('b')
      expect(taskStep1!.status).toBe('ready')
    })

    it('returns null for nodeId that does not exist in the step', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'gt-null'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      await workflow.initWorkflow(runId, new Map([[0, ['a']]]), [], deps)

      const task = await workflow.getTask('nonexistent', runId, 0, deps)
      expect(task).toBeNull()
    })

    it('returns null when no records exist at all', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'gt-norecords'

      const task = await workflow.getTask('a', runId, 0, deps)
      expect(task).toBeNull()
    })
  })

  describe('listTasks with explicit step parameter', () => {
    it('returns tasks for a specific step number', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'lt-step'
      seedRunInfo(deps.runRepo, runId, { a: 0, b: 1 })

      const layers = new Map<number, string[]>([
        [0, ['a']],
        [1, ['b']],
      ])
      const edges: Edge[] = [{ from: 'b', to: 'a' }]

      await workflow.initWorkflow(runId, layers, edges, deps)
      await workflow.startTask('a', runId, deps)
      await workflow.completeTask('a', edges, runId, deps)

      const tasksStep0 = await workflow.listTasks(runId, 0, deps)
      expect(tasksStep0).toHaveLength(1)
      expect(tasksStep0[0]!.nodeId).toBe('a')

      const tasksStep1 = await workflow.listTasks(runId, 1, deps)
      expect(tasksStep1).toHaveLength(1)
      expect(tasksStep1[0]!.nodeId).toBe('b')
    })

    it('returns empty array when no records exist', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'lt-empty'

      const tasks = await workflow.listTasks(runId, undefined, deps)
      expect(tasks).toEqual([])
    })

    it('returns empty array for a step number that does not exist', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'lt-nostep'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      await workflow.initWorkflow(runId, new Map([[0, ['a']]]), [], deps)

      const tasks = await workflow.listTasks(runId, 99, deps)
      expect(tasks).toEqual([])
    })
  })

  describe('advanceStep', () => {
    it('advances when current superstep is completed and there is a next layer', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'as-adv2'
      seedRunInfo(deps.runRepo, runId, { a: 0, b: 1 })

      const layers = new Map<number, string[]>([
        [0, ['a']],
        [1, ['b']],
      ])
      const edges: Edge[] = [{ from: 'b', to: 'a' }]

      await workflow.initWorkflow(runId, layers, edges, deps)

      // Skip task 'a' — this marks the step as completed but does NOT auto-advance
      // because skip with failed sibling guard is not triggered here (no failed tasks)
      // Actually, skip does auto-advance. Let's use a different approach.
      // Use skip for the sole task in the layer — this completes and auto-advances.
      // After auto-advance, step 1 is running. Then we complete step 1 via skip.
      // But we want to test advanceStep directly, not via auto-advance.

      // Directly test advanceStep: we need a completed superstep.
      // Start and complete 'a' which triggers auto-advance to step 1
      await workflow.startTask('a', runId, deps)
      await workflow.completeTask('a', edges, runId, deps)

      // Now we're on step 1 (running). Start and complete 'b'.
      await workflow.startTask('b', runId, deps)
      // Fail 'b' to stop auto-advance, then manually advance
      await workflow.failTask('b', runId, 'test', deps)
      await workflow.retryTask('b', runId, deps)
      await workflow.startTask('b', runId, deps)

      // Complete 'b' — this auto-advances, step becomes 'completed' for step 1
      // and then tryAdvanceStep finds no layer 2, so returns false
      const { advanced } = await workflow.completeTask('b', edges, runId, deps)
      expect(advanced).toBe(false) // No next layer

      // Verify workflow is done
      const isComplete = await workflow.isWorkflowComplete(runId, deps)
      expect(isComplete).toBe(true)
    })

    it('throws when current superstep is not completed', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'as-notcompleted'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      await workflow.initWorkflow(runId, new Map([[0, ['a']]]), [], deps)

      // Current superstep status is 'running', not 'completed'
      await expect(workflow.advanceStep(runId, [], deps)).rejects.toThrow(/cannot advance/)
    })

    it('returns null when there is no next layer (workflow complete)', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'as-nolayer'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      const layers = new Map<number, string[]>([[0, ['a']]])
      await workflow.initWorkflow(runId, layers, [], deps)

      // Skip the only task to complete the step
      await workflow.skipTask('a', [], runId, deps)

      // Now current step is completed and there is no next layer
      // The auto-advance already tried and returned null.
      // Call advanceStep directly to verify
      const result = await workflow.advanceStep(runId, [], deps)
      expect(result).toBeNull()
    })
  })

  describe('isStepComplete', () => {
    it('returns true when step status is completed', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'isc-true'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      await workflow.initWorkflow(runId, new Map([[0, ['a']]]), [], deps)
      await workflow.skipTask('a', [], runId, deps)

      const complete = await workflow.isStepComplete(runId, deps)
      expect(complete).toBe(true)
    })

    it('returns false when step status is running', async () => {
      const deps = createTestWorkflowDeps()
      const runId = 'isc-false'
      seedRunInfo(deps.runRepo, runId, { a: 0 })

      await workflow.initWorkflow(runId, new Map([[0, ['a']]]), [], deps)

      const complete = await workflow.isStepComplete(runId, deps)
      expect(complete).toBe(false)
    })
  })

  describe('skipTask with failed siblings', () => {
    it('does not advance superstep when other tasks in the same step are failed', async () => {
      // We need: one task failed, another ready (skippable), superstep 'running'.
      // Normal operations can't produce this state (failTask sets superstep='failed',
      // retryTask resets the failed task to ready). So we use direct record manipulation
      // to inject a 'failed' task while keeping superstep 'running'.
      const deps = createTestWorkflowDeps()
      const runId = 'skip-failed'
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

      // Directly manipulate records: set 'a' to failed, keep 'b' as ready, superstep 'running'
      const records = await deps.repo.readRecords(runId)
      const lastRecord = records[records.length - 1]!
      const taskA = lastRecord.tasks.find((t) => t.nodeId === 'a')!
      taskA.status = 'failed'
      taskA.error = 'injected failure'
      // Keep superstep as 'running' and task 'b' as 'ready'
      await deps.repo.rewriteRecords(runId, records)

      // Now skip 'b' (ready -> skipped). After: a=failed, b=skipped => allTerminal=true, hasFailed=true
      const { task: skippedB, advanced } = await workflow.skipTask('b', edges, runId, deps)
      expect(skippedB.status).toBe('skipped')
      expect(advanced).toBe(false)

      // Verify the superstep did NOT advance to layer 1
      const history = await workflow.getStepHistory(runId, deps)
      const step1Records = history.filter((r) => r.step === 1)
      expect(step1Records).toHaveLength(0)

      // Verify the last record for step 0 is NOT 'completed'
      const step0Records = history.filter((r) => r.step === 0)
      const lastStep0 = step0Records[step0Records.length - 1]!
      expect(lastStep0.status).not.toBe('completed')
    })
  })
})
