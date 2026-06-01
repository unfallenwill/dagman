import { describe, it, expect, vi } from 'vitest'
import type { StorageBackend } from '../../../src/shared/models/storage-backend.js'
import {
  BackendStateStore,
  BackendChannelStore,
  BackendTaskStore,
  BackendRunStore,
} from '../../../src/infra/storage/backend-bridges.js'
import type { RunInfo, Task } from '../../../src/shared/models/compiled-graph.js'

function createMockBackend(): StorageBackend & Record<string, ReturnType<typeof vi.fn>> {
  return {
    initState: vi.fn().mockResolvedValue(undefined),
    readState: vi.fn().mockResolvedValue({}),
    patchState: vi.fn().mockResolvedValue(undefined),
    resetState: vi.fn().mockResolvedValue(undefined),

    initChannels: vi.fn().mockResolvedValue(undefined),
    readAllChannels: vi.fn().mockResolvedValue({}),
    readChannel: vi.fn().mockResolvedValue(null),
    triggerChannel: vi.fn().mockResolvedValue(undefined),
    barrierWrite: vi.fn().mockResolvedValue(false),
    getChannelVersion: vi.fn().mockResolvedValue(0),

    createTasks: vi.fn().mockResolvedValue(undefined),
    readAllTasks: vi.fn().mockResolvedValue([]),
    readTasksByStep: vi.fn().mockResolvedValue([]),
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
    clearTasks: vi.fn().mockResolvedValue(undefined),

    createRunInfo: vi.fn().mockResolvedValue(undefined),
    readRunInfo: vi.fn().mockResolvedValue({} as RunInfo),
    updateRunInfo: vi.fn().mockResolvedValue(undefined),

    listRunIds: vi.fn().mockResolvedValue([]),
    readCurrentRunId: vi.fn().mockResolvedValue(null),
    writeCurrentRunId: vi.fn().mockResolvedValue(undefined),
    hasRun: vi.fn().mockResolvedValue(false),

    writeGraphRef: vi.fn().mockResolvedValue(undefined),
    readGraphRef: vi.fn().mockResolvedValue({}),
  }
}

describe('BackendStateStore', () => {
  const mock = createMockBackend()
  const store = new BackendStateStore(mock)

  it('init delegates to backend.initState', async () => {
    await store.init('run-1', { count: 0 })
    expect(mock.initState).toHaveBeenCalledWith('run-1', { count: 0 })
  })

  it('read delegates to backend.readState', async () => {
    await store.read('run-1')
    expect(mock.readState).toHaveBeenCalledWith('run-1')
  })

  it('patch delegates to backend.patchState', async () => {
    await store.patch('run-1', { count: 5 })
    expect(mock.patchState).toHaveBeenCalledWith('run-1', { count: 5 })
  })

  it('reset delegates to backend.resetState', async () => {
    await store.reset('run-1')
    expect(mock.resetState).toHaveBeenCalledWith('run-1')
  })
})

describe('BackendChannelStore', () => {
  const mock = createMockBackend()
  const store = new BackendChannelStore(mock)

  it('init delegates to backend.initChannels', async () => {
    const channels = { 'trigger:A': { type: 'trigger' as const } }
    await store.init('run-1', channels)
    expect(mock.initChannels).toHaveBeenCalledWith('run-1', channels)
  })

  it('readAll delegates to backend.readAllChannels', async () => {
    await store.readAll('run-1')
    expect(mock.readAllChannels).toHaveBeenCalledWith('run-1')
  })

  it('read delegates to backend.readChannel', async () => {
    await store.read('run-1', 'trigger:A')
    expect(mock.readChannel).toHaveBeenCalledWith('run-1', 'trigger:A')
  })

  it('trigger delegates to backend.triggerChannel', async () => {
    await store.trigger('run-1', 'trigger:A')
    expect(mock.triggerChannel).toHaveBeenCalledWith('run-1', 'trigger:A')
  })

  it('barrierWrite delegates to backend.barrierWrite', async () => {
    await store.barrierWrite('run-1', 'barrier:B', 'A')
    expect(mock.barrierWrite).toHaveBeenCalledWith('run-1', 'barrier:B', 'A')
  })

  it('getVersion delegates to backend.getChannelVersion', async () => {
    await store.getVersion('run-1', 'trigger:A')
    expect(mock.getChannelVersion).toHaveBeenCalledWith('run-1', 'trigger:A')
  })
})

describe('BackendTaskStore', () => {
  const mock = createMockBackend()
  const store = new BackendTaskStore(mock)

  const tasks: Task[] = [{ id: 'A@step0', nodeId: 'A', step: 0, status: 'ready' }]

  it('create delegates to backend.createTasks', async () => {
    await store.create('run-1', tasks)
    expect(mock.createTasks).toHaveBeenCalledWith('run-1', tasks)
  })

  it('readAll delegates to backend.readAllTasks', async () => {
    await store.readAll('run-1')
    expect(mock.readAllTasks).toHaveBeenCalledWith('run-1')
  })

  it('readByStep delegates to backend.readTasksByStep', async () => {
    await store.readByStep('run-1', 0)
    expect(mock.readTasksByStep).toHaveBeenCalledWith('run-1', 0)
  })

  it('updateStatus delegates to backend.updateTaskStatus', async () => {
    await store.updateStatus('run-1', 'A', 0, 'running')
    expect(mock.updateTaskStatus).toHaveBeenCalledWith('run-1', 'A', 0, 'running', undefined)
  })

  it('updateStatus passes error to backend', async () => {
    await store.updateStatus('run-1', 'A', 0, 'failed', 'oops')
    expect(mock.updateTaskStatus).toHaveBeenCalledWith('run-1', 'A', 0, 'failed', 'oops')
  })

  it('clear delegates to backend.clearTasks', async () => {
    await store.clear('run-1')
    expect(mock.clearTasks).toHaveBeenCalledWith('run-1')
  })
})

describe('BackendRunStore', () => {
  const mock = createMockBackend()
  const store = new BackendRunStore(mock)

  const info: RunInfo = {
    id: 'run-1',
    createdAt: '2026-01-15T10:00:00.000Z',
    currentStep: 0,
    currentStepScheduled: false,
    status: 'idle',
  }

  it('create delegates to backend.createRunInfo', async () => {
    await store.create(info)
    expect(mock.createRunInfo).toHaveBeenCalledWith(info)
  })

  it('read delegates to backend.readRunInfo', async () => {
    await store.read('run-1')
    expect(mock.readRunInfo).toHaveBeenCalledWith('run-1')
  })

  it('update delegates to backend.updateRunInfo', async () => {
    await store.update('run-1', { status: 'running' })
    expect(mock.updateRunInfo).toHaveBeenCalledWith('run-1', { status: 'running' })
  })

  it('listIds delegates to backend.listRunIds', async () => {
    await store.listIds()
    expect(mock.listRunIds).toHaveBeenCalledWith()
  })

  it('readCurrentId delegates to backend.readCurrentRunId', async () => {
    await store.readCurrentId()
    expect(mock.readCurrentRunId).toHaveBeenCalledWith()
  })

  it('writeCurrentId delegates to backend.writeCurrentRunId', async () => {
    await store.writeCurrentId('run-1')
    expect(mock.writeCurrentRunId).toHaveBeenCalledWith('run-1')
  })

  it('exists delegates to backend.hasRun', async () => {
    await store.exists('run-1')
    expect(mock.hasRun).toHaveBeenCalledWith('run-1')
  })
})
