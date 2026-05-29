import { describe, it, expect } from 'vitest'
import {
  isStepTerminal,
  isWorkflowComplete,
  getFanoutItemsForNode,
  createTasksForLayer,
} from '../../src/domain/workflow/superstep-logic.js'
import { createTask } from '../../src/shared/models/task.js'
import type { Channel } from '../../src/shared/models/channel.js'

function makeChannel(name: string, value: unknown, version: number): Channel {
  return { name, value, version, updatedAt: '2025-01-01T00:00:00.000Z' }
}

describe('isStepTerminal', () => {
  it('returns true for empty array', () => {
    expect(isStepTerminal([])).toBe(true)
  })

  it('returns true when all tasks are terminal', () => {
    const tasks = [
      { ...createTask('a', 0), status: 'success' as const },
      { ...createTask('b', 0), status: 'skipped' as const },
      { ...createTask('c', 0), status: 'failed' as const },
    ]
    expect(isStepTerminal(tasks)).toBe(true)
  })

  it('returns false when some tasks are non-terminal', () => {
    const tasks = [
      { ...createTask('a', 0), status: 'success' as const },
      { ...createTask('b', 0), status: 'running' as const },
    ]
    expect(isStepTerminal(tasks)).toBe(false)
  })

  it('returns false when no tasks are terminal', () => {
    const tasks = [
      { ...createTask('a', 0), status: 'ready' as const },
      { ...createTask('b', 0), status: 'running' as const },
    ]
    expect(isStepTerminal(tasks)).toBe(false)
  })
})

describe('isWorkflowComplete', () => {
  it('returns true when status is completed and all tasks are success', () => {
    const tasks = [
      { ...createTask('a', 0), status: 'success' as const },
      { ...createTask('b', 0), status: 'success' as const },
    ]
    expect(isWorkflowComplete('completed', tasks)).toBe(true)
  })

  it('returns true when status is completed with skipped tasks', () => {
    const tasks = [
      { ...createTask('a', 0), status: 'success' as const },
      { ...createTask('b', 0), status: 'skipped' as const },
    ]
    expect(isWorkflowComplete('completed', tasks)).toBe(true)
  })

  it('returns false when status is completed but some tasks failed', () => {
    const tasks = [
      { ...createTask('a', 0), status: 'success' as const },
      { ...createTask('b', 0), status: 'failed' as const },
    ]
    expect(isWorkflowComplete('completed', tasks)).toBe(false)
  })

  it('returns false when status is running', () => {
    const tasks = [{ ...createTask('a', 0), status: 'success' as const }]
    expect(isWorkflowComplete('running', tasks)).toBe(false)
  })
})

describe('getFanoutItemsForNode', () => {
  it('returns null when no fanout channels exist', () => {
    const channels: Record<string, Channel> = {
      'edge:a→b': makeChannel('edge:a→b', 'success', 1),
    }
    expect(getFanoutItemsForNode('b', channels)).toBeNull()
  })

  it('returns items when fanout channel targets the node', () => {
    const items = ['item1', 'item2', 'item3']
    const channels: Record<string, Channel> = {
      '_fanout.a→b': makeChannel('_fanout.a→b', items, 1),
    }
    const result = getFanoutItemsForNode('b', channels)
    expect(result).toEqual(items)
  })

  it('returns null when fanout channel targets a different node', () => {
    const items = ['item1']
    const channels: Record<string, Channel> = {
      '_fanout.a→c': makeChannel('_fanout.a→c', items, 1),
    }
    expect(getFanoutItemsForNode('b', channels)).toBeNull()
  })

  it('returns null when fanout channel value is not an array', () => {
    const channels: Record<string, Channel> = {
      '_fanout.a→b': makeChannel('_fanout.a→b', 'not-array', 1),
    }
    expect(getFanoutItemsForNode('b', channels)).toBeNull()
  })
})

describe('createTasksForLayer', () => {
  it('creates one task per normal node', () => {
    const tasks = createTasksForLayer(['a', 'b', 'c'], 0, {})
    expect(tasks).toHaveLength(3)
    expect(tasks[0]!.nodeId).toBe('a')
    expect(tasks[1]!.nodeId).toBe('b')
    expect(tasks[2]!.nodeId).toBe('c')
    expect(tasks.every((t) => t.status === 'ready')).toBe(true)
  })

  it('creates normal tasks when no channels provided', () => {
    const tasks = createTasksForLayer(['x'], 2, {})
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.step).toBe(2)
  })

  it('creates dynamic tasks for fanout nodes', () => {
    const items = ['alpha', 'beta']
    const channels: Record<string, Channel> = {
      '_fanout.src→fanout-node': makeChannel('_fanout.src→fanout-node', items, 1),
    }
    const tasks = createTasksForLayer(['fanout-node'], 1, channels)
    expect(tasks).toHaveLength(2)
    expect(tasks[0]!.kind).toBe('dynamic')
    expect(tasks[0]!.fanOutIndex).toBe(0)
    expect(tasks[0]!.fanOutParam).toBe('alpha')
    expect(tasks[1]!.kind).toBe('dynamic')
    expect(tasks[1]!.fanOutIndex).toBe(1)
    expect(tasks[1]!.fanOutParam).toBe('beta')
  })

  it('creates normal task when fanout items array is empty', () => {
    const channels: Record<string, Channel> = {
      '_fanout.src→fanout-node': makeChannel('_fanout.src→fanout-node', [], 1),
    }
    const tasks = createTasksForLayer(['fanout-node'], 1, channels)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.kind).toBe('execution')
  })

  it('mixes normal and dynamic tasks in same layer', () => {
    const items = ['x', 'y']
    const channels: Record<string, Channel> = {
      '_fanout.src→dyn': makeChannel('_fanout.src→dyn', items, 1),
    }
    const tasks = createTasksForLayer(['normal', 'dyn'], 0, channels)
    expect(tasks).toHaveLength(3)
    expect(tasks[0]!.nodeId).toBe('normal')
    expect(tasks[0]!.kind).toBe('execution')
    expect(tasks[1]!.nodeId).toBe('dyn')
    expect(tasks[1]!.kind).toBe('dynamic')
    expect(tasks[2]!.nodeId).toBe('dyn')
    expect(tasks[2]!.kind).toBe('dynamic')
  })
})
