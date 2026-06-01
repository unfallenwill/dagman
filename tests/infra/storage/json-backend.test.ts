import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initTmpDir, cleanupTmpDir } from '../../helpers/setup.js'
import {
  getStateFile,
  getChannelsFile,
  getTasksFile,
  getRunMetaFile,
  getGraphFile,
  getRunsDir,
  getDagmanDir,
  getCurrentRunFilePath,
} from '../../../src/infra/fs/paths.js'
import { ensureDir, readJSON, writeJSON, fileExists } from '../../../src/infra/fs/file-ops.js'
import { fixedClock } from '../../../src/shared/utils/clock.js'
import { JsonStorageBackend } from '../../../src/infra/storage/json-backend.js'
import type { BackendDeps } from '../../../src/infra/storage/backend-factory.js'
import type { Task, RunInfo } from '../../../src/shared/models/compiled-graph.js'

function makeDeps(): BackendDeps {
  return {
    getStateFile,
    getChannelsFile,
    getTasksFile,
    getRunMetaFile,
    getGraphFile,
    getRunsDir,
    getDagmanDir,
    getCurrentRunFilePath,
    ensureDir,
    readJSON,
    writeJSON,
    fileExists,
    clock: fixedClock('2026-01-15T12:00:00.000Z'),
  }
}

const RUN_ID = 'test-run'

describe('JsonStorageBackend', () => {
  let backend: JsonStorageBackend

  beforeEach(() => {
    initTmpDir()
    backend = new JsonStorageBackend(makeDeps())
  })

  afterEach(async () => {
    await cleanupTmpDir()
  })

  // ── State ──────────────────────────────────────────────────────────

  describe('state', () => {
    it('should initialize state from schema', async () => {
      await backend.initState(RUN_ID, { count: 0, name: 'init' })
      const state = await backend.readState(RUN_ID)
      expect(state).toEqual({ count: 0, name: 'init' })
    })

    it('should return empty object when state file does not exist', async () => {
      const state = await backend.readState(RUN_ID)
      expect(state).toEqual({})
    })

    it('should patch state by merging', async () => {
      await backend.initState(RUN_ID, { count: 0, name: 'init' })
      await backend.patchState(RUN_ID, { count: 5, extra: true })
      const state = await backend.readState(RUN_ID)
      expect(state).toEqual({ count: 5, name: 'init', extra: true })
    })

    it('should reset state to empty object', async () => {
      await backend.initState(RUN_ID, { count: 0 })
      await backend.resetState(RUN_ID)
      const state = await backend.readState(RUN_ID)
      expect(state).toEqual({})
    })

    it('should not throw when resetting non-existent state', async () => {
      await expect(backend.resetState(RUN_ID)).resolves.toBeUndefined()
    })
  })

  // ── Channels ───────────────────────────────────────────────────────

  describe('channels', () => {
    it('should initialize trigger and barrier channels', async () => {
      await backend.initChannels(RUN_ID, {
        'trigger:A→B': { type: 'trigger' },
        'barrier:B': { type: 'barrier', writers: ['A', 'C'] },
      })
      const channels = await backend.readAllChannels(RUN_ID)
      expect(channels['trigger:A→B']).toEqual({
        name: 'trigger:A→B',
        type: 'trigger',
        version: 0,
      })
      expect(channels['barrier:B']).toEqual({
        name: 'barrier:B',
        type: 'barrier',
        writers: ['A', 'C'],
        received: [],
        version: 0,
      })
    })

    it('should return empty object when channels file does not exist', async () => {
      const channels = await backend.readAllChannels(RUN_ID)
      expect(channels).toEqual({})
    })

    it('should read a single channel by name', async () => {
      await backend.initChannels(RUN_ID, {
        'trigger:A→B': { type: 'trigger' },
        'trigger:C→D': { type: 'trigger' },
      })
      const ch = await backend.readChannel(RUN_ID, 'trigger:A→B')
      expect(ch).toEqual({ name: 'trigger:A→B', type: 'trigger', version: 0 })
    })

    it('should return null for non-existent channel', async () => {
      await backend.initChannels(RUN_ID, { 'trigger:X': { type: 'trigger' } })
      const ch = await backend.readChannel(RUN_ID, 'nope')
      expect(ch).toBeNull()
    })

    it('should trigger a channel by incrementing version', async () => {
      await backend.initChannels(RUN_ID, { 'trigger:A→B': { type: 'trigger' } })
      await backend.triggerChannel(RUN_ID, 'trigger:A→B')
      const version = await backend.getChannelVersion(RUN_ID, 'trigger:A→B')
      expect(version).toBe(1)
    })

    it('should throw when triggering a non-existent channel', async () => {
      await backend.initChannels(RUN_ID, {})
      await expect(backend.triggerChannel(RUN_ID, 'trigger:missing')).rejects.toThrow(
        "trigger channel 'trigger:missing' not found",
      )
    })

    it('should throw when triggering a barrier channel', async () => {
      await backend.initChannels(RUN_ID, { 'barrier:B': { type: 'barrier', writers: ['A'] } })
      await expect(backend.triggerChannel(RUN_ID, 'barrier:B')).rejects.toThrow(
        "trigger channel 'barrier:B' not found",
      )
    })

    it('should get channel version', async () => {
      await backend.initChannels(RUN_ID, { 'trigger:X': { type: 'trigger' } })
      expect(await backend.getChannelVersion(RUN_ID, 'trigger:X')).toBe(0)
    })

    it('should throw when getting version of missing channel', async () => {
      await backend.initChannels(RUN_ID, {})
      await expect(backend.getChannelVersion(RUN_ID, 'missing')).rejects.toThrow(
        "channel 'missing' not found",
      )
    })

    it('should write to barrier channel and track writers', async () => {
      await backend.initChannels(RUN_ID, {
        'barrier:B': { type: 'barrier', writers: ['A', 'C'] },
      })
      const complete1 = await backend.barrierWrite(RUN_ID, 'barrier:B', 'A')
      expect(complete1).toBe(false)
      const ch = await backend.readChannel(RUN_ID, 'barrier:B')
      expect(ch!.type).toBe('barrier')
      if (ch!.type === 'barrier') {
        expect(ch!.received).toEqual(['A'])
      }

      const complete2 = await backend.barrierWrite(RUN_ID, 'barrier:B', 'C')
      expect(complete2).toBe(true)
    })

    it('should set barrier version to 1 when all writers complete', async () => {
      await backend.initChannels(RUN_ID, {
        'barrier:B': { type: 'barrier', writers: ['A'] },
      })
      await backend.barrierWrite(RUN_ID, 'barrier:B', 'A')
      const version = await backend.getChannelVersion(RUN_ID, 'barrier:B')
      expect(version).toBe(1)
    })

    it('should not duplicate writer in barrier received list', async () => {
      await backend.initChannels(RUN_ID, {
        'barrier:B': { type: 'barrier', writers: ['A', 'C'] },
      })
      await backend.barrierWrite(RUN_ID, 'barrier:B', 'A')
      await backend.barrierWrite(RUN_ID, 'barrier:B', 'A')
      const ch = await backend.readChannel(RUN_ID, 'barrier:B')
      expect(ch!.type).toBe('barrier')
      if (ch!.type === 'barrier') {
        expect(ch!.received).toEqual(['A'])
      }
    })

    it('should throw when writing to a non-existent barrier channel', async () => {
      await backend.initChannels(RUN_ID, {})
      await expect(backend.barrierWrite(RUN_ID, 'barrier:missing', 'A')).rejects.toThrow(
        "barrier channel 'barrier:missing' not found",
      )
    })
  })

  // ── Tasks ───────────────────────────────────────────────────────────

  describe('tasks', () => {
    const makeTask = (nodeId: string, step: number): Task => ({
      id: `${nodeId}@step${step}`,
      nodeId,
      step,
      status: 'ready',
    })

    it('should create tasks', async () => {
      const tasks = [makeTask('A', 0), makeTask('B', 0)]
      await backend.createTasks(RUN_ID, tasks)
      const all = await backend.readAllTasks(RUN_ID)
      expect(all).toHaveLength(2)
      expect(all[0]!.nodeId).toBe('A')
      expect(all[1]!.nodeId).toBe('B')
    })

    it('should return empty array when no tasks file exists', async () => {
      const all = await backend.readAllTasks(RUN_ID)
      expect(all).toEqual([])
    })

    it('should append tasks to existing ones', async () => {
      await backend.createTasks(RUN_ID, [makeTask('A', 0)])
      await backend.createTasks(RUN_ID, [makeTask('B', 1)])
      const all = await backend.readAllTasks(RUN_ID)
      expect(all).toHaveLength(2)
    })

    it('should read tasks by step', async () => {
      await backend.createTasks(RUN_ID, [makeTask('A', 0), makeTask('B', 0), makeTask('C', 1)])
      const step0 = await backend.readTasksByStep(RUN_ID, 0)
      expect(step0).toHaveLength(2)
      const step1 = await backend.readTasksByStep(RUN_ID, 1)
      expect(step1).toHaveLength(1)
    })

    it('should update task status to running and set startedAt', async () => {
      await backend.createTasks(RUN_ID, [makeTask('A', 0)])
      await backend.updateTaskStatus(RUN_ID, 'A', 0, 'running')
      const all = await backend.readAllTasks(RUN_ID)
      expect(all[0]!.status).toBe('running')
      expect(all[0]!.startedAt).toBe('2026-01-15T12:00:00.000Z')
    })

    it('should update task status to success and set completedAt', async () => {
      await backend.createTasks(RUN_ID, [makeTask('A', 0)])
      await backend.updateTaskStatus(RUN_ID, 'A', 0, 'running')
      await backend.updateTaskStatus(RUN_ID, 'A', 0, 'success')
      const all = await backend.readAllTasks(RUN_ID)
      expect(all[0]!.status).toBe('success')
      expect(all[0]!.completedAt).toBe('2026-01-15T12:00:00.000Z')
    })

    it('should update task status to failed with error', async () => {
      await backend.createTasks(RUN_ID, [makeTask('A', 0)])
      await backend.updateTaskStatus(RUN_ID, 'A', 0, 'running')
      await backend.updateTaskStatus(RUN_ID, 'A', 0, 'failed', 'something broke')
      const all = await backend.readAllTasks(RUN_ID)
      expect(all[0]!.status).toBe('failed')
      expect(all[0]!.error).toBe('something broke')
      expect(all[0]!.completedAt).toBe('2026-01-15T12:00:00.000Z')
    })

    it('should throw when updating non-existent task', async () => {
      await backend.createTasks(RUN_ID, [makeTask('A', 0)])
      await expect(backend.updateTaskStatus(RUN_ID, 'Z', 0, 'running')).rejects.toThrow(
        "task 'Z@step0' not found",
      )
    })

    it('should clear all tasks', async () => {
      await backend.createTasks(RUN_ID, [makeTask('A', 0), makeTask('B', 1)])
      await backend.clearTasks(RUN_ID)
      const all = await backend.readAllTasks(RUN_ID)
      expect(all).toEqual([])
    })
  })

  // ── Run Info ────────────────────────────────────────────────────────

  describe('run info', () => {
    const makeRunInfo = (id: string): RunInfo => ({
      id,
      createdAt: '2026-01-15T10:00:00.000Z',
      currentStep: 0,
      currentStepScheduled: false,
      status: 'idle',
    })

    it('should create and read run info', async () => {
      const info = makeRunInfo(RUN_ID)
      await backend.createRunInfo(info)
      const read = await backend.readRunInfo(RUN_ID)
      expect(read.id).toBe(RUN_ID)
      expect(read.status).toBe('idle')
      expect(read.currentStepScheduled).toBe(false)
    })

    it('should default currentStepScheduled to false for backward compat', async () => {
      const info = makeRunInfo(RUN_ID)
      await backend.createRunInfo(info)
      const read = await backend.readRunInfo(RUN_ID)
      expect(read.currentStepScheduled).toBe(false)
    })

    it('should update run info with partial patch', async () => {
      const info = makeRunInfo(RUN_ID)
      await backend.createRunInfo(info)
      await backend.updateRunInfo(RUN_ID, { currentStep: 2, status: 'running' })
      const updated = await backend.readRunInfo(RUN_ID)
      expect(updated.currentStep).toBe(2)
      expect(updated.status).toBe('running')
      expect(updated.id).toBe(RUN_ID)
    })

    it('should list run IDs', async () => {
      await backend.createRunInfo(makeRunInfo('run-1'))
      await backend.createRunInfo(makeRunInfo('run-2'))
      const ids = await backend.listRunIds()
      expect(ids.sort()).toEqual(['run-1', 'run-2'])
    })

    it('should return empty array when no runs exist', async () => {
      const ids = await backend.listRunIds()
      expect(ids).toEqual([])
    })
  })

  // ── Run Registry ────────────────────────────────────────────────────

  describe('run registry', () => {
    it('should write and read current run ID', async () => {
      await backend.writeCurrentRunId('run-abc')
      const id = await backend.readCurrentRunId()
      expect(id).toBe('run-abc')
    })

    it('should return null when no current run file exists', async () => {
      const id = await backend.readCurrentRunId()
      expect(id).toBeNull()
    })

    it('should report hasRun as true for existing run', async () => {
      const info: RunInfo = {
        id: 'run-exists',
        createdAt: '2026-01-15T10:00:00.000Z',
        currentStep: 0,
        currentStepScheduled: false,
        status: 'idle',
      }
      await backend.createRunInfo(info)
      expect(await backend.hasRun('run-exists')).toBe(true)
    })

    it('should report hasRun as false for non-existent run', async () => {
      expect(await backend.hasRun('no-such-run')).toBe(false)
    })
  })

  // ── Graph Reference ─────────────────────────────────────────────────

  describe('graph reference', () => {
    it('should write and read graph reference data', async () => {
      const graphData = { name: 'my-graph', layers: [['A'], ['B', 'C']] }
      await backend.writeGraphRef(RUN_ID, graphData)
      const read = await backend.readGraphRef<{ name: string; layers: string[][] }>(RUN_ID)
      expect(read).toEqual(graphData)
    })
  })
})
