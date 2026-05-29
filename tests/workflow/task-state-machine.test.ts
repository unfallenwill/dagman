import { describe, it, expect } from 'vitest'
import { createTask } from '../../src/shared/models/task.js'
import {
  canStart,
  canComplete,
  canFail,
  canSkip,
  canRetry,
  transitionToRunning,
  transitionToSuccess,
  transitionToFailed,
  transitionToSkipped,
  transitionToReady,
} from '../../src/workflow/task-state-machine.js'

const TS = '2025-01-01T00:00:00.000Z'

describe('canStart', () => {
  it('returns true for ready task', () => {
    const task = createTask('a', 0)
    expect(canStart(task)).toBe(true)
  })

  it('returns false for running task', () => {
    const task = { ...createTask('a', 0), status: 'running' as const }
    expect(canStart(task)).toBe(false)
  })

  it('returns false for success task', () => {
    const task = { ...createTask('a', 0), status: 'success' as const }
    expect(canStart(task)).toBe(false)
  })

  it('returns false for failed task', () => {
    const task = { ...createTask('a', 0), status: 'failed' as const }
    expect(canStart(task)).toBe(false)
  })

  it('returns false for skipped task', () => {
    const task = { ...createTask('a', 0), status: 'skipped' as const }
    expect(canStart(task)).toBe(false)
  })
})

describe('canComplete', () => {
  it('returns true for running task', () => {
    const task = { ...createTask('a', 0), status: 'running' as const }
    expect(canComplete(task)).toBe(true)
  })

  it('returns false for ready task', () => {
    const task = createTask('a', 0)
    expect(canComplete(task)).toBe(false)
  })
})

describe('canFail', () => {
  it('returns true for running task', () => {
    const task = { ...createTask('a', 0), status: 'running' as const }
    expect(canFail(task)).toBe(true)
  })

  it('returns false for ready task', () => {
    const task = createTask('a', 0)
    expect(canFail(task)).toBe(false)
  })
})

describe('canSkip', () => {
  it('returns true for ready task', () => {
    const task = createTask('a', 0)
    expect(canSkip(task)).toBe(true)
  })

  it('returns false for running task', () => {
    const task = { ...createTask('a', 0), status: 'running' as const }
    expect(canSkip(task)).toBe(false)
  })
})

describe('canRetry', () => {
  it('returns true for failed task', () => {
    const task = { ...createTask('a', 0), status: 'failed' as const }
    expect(canRetry(task)).toBe(true)
  })

  it('returns false for success task', () => {
    const task = { ...createTask('a', 0), status: 'success' as const }
    expect(canRetry(task)).toBe(false)
  })

  it('returns false for ready task', () => {
    const task = createTask('a', 0)
    expect(canRetry(task)).toBe(false)
  })
})

describe('transitionToRunning', () => {
  it('returns new task with status running and startedAt set', () => {
    const task = createTask('a', 0)
    const result = transitionToRunning(task, TS)
    expect(result.status).toBe('running')
    expect(result.startedAt).toBe(TS)
  })

  it('does not mutate the original task', () => {
    const task = createTask('a', 0)
    const original = { ...task }
    transitionToRunning(task, TS)
    expect(task).toEqual(original)
  })
})

describe('transitionToSuccess', () => {
  it('returns new task with status success and completedAt set', () => {
    const task = { ...createTask('a', 0), status: 'running' as const }
    const result = transitionToSuccess(task, TS)
    expect(result.status).toBe('success')
    expect(result.completedAt).toBe(TS)
  })

  it('does not mutate the original task', () => {
    const task = { ...createTask('a', 0), status: 'running' as const }
    const original = { ...task }
    transitionToSuccess(task, TS)
    expect(task).toEqual(original)
  })
})

describe('transitionToFailed', () => {
  it('returns new task with status failed, completedAt, and error', () => {
    const task = { ...createTask('a', 0), status: 'running' as const }
    const result = transitionToFailed(task, TS, 'something broke')
    expect(result.status).toBe('failed')
    expect(result.completedAt).toBe(TS)
    expect(result.error).toBe('something broke')
  })

  it('returns new task without error when error is omitted', () => {
    const task = { ...createTask('a', 0), status: 'running' as const }
    const result = transitionToFailed(task, TS)
    expect(result.status).toBe('failed')
    expect(result.error).toBeUndefined()
  })

  it('does not mutate the original task', () => {
    const task = { ...createTask('a', 0), status: 'running' as const }
    const original = { ...task }
    transitionToFailed(task, TS, 'err')
    expect(task).toEqual(original)
  })
})

describe('transitionToSkipped', () => {
  it('returns new task with status skipped and completedAt set', () => {
    const task = createTask('a', 0)
    const result = transitionToSkipped(task, TS)
    expect(result.status).toBe('skipped')
    expect(result.completedAt).toBe(TS)
  })

  it('does not mutate the original task', () => {
    const task = createTask('a', 0)
    const original = { ...task }
    transitionToSkipped(task, TS)
    expect(task).toEqual(original)
  })
})

describe('transitionToReady', () => {
  it('returns new task with status ready and timestamps cleared', () => {
    const task = {
      ...createTask('a', 0),
      status: 'failed' as const,
      startedAt: TS,
      completedAt: TS,
      error: 'oops',
    }
    const result = transitionToReady(task)
    expect(result.status).toBe('ready')
    expect(result.startedAt).toBeUndefined()
    expect(result.completedAt).toBeUndefined()
    expect(result.error).toBeUndefined()
  })

  it('does not mutate the original task', () => {
    const task = {
      ...createTask('a', 0),
      status: 'failed' as const,
      startedAt: TS,
      completedAt: TS,
      error: 'oops',
    }
    const original = { ...task }
    transitionToReady(task)
    expect(task).toEqual(original)
  })
})
