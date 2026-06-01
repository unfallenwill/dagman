import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../../../src/engine/default-deps.js'
import { initTmpDir, cleanupTmpDir } from '../../helpers/setup.js'
import {
  readState,
  patchState,
  getStateKey,
  setDefaultStateServiceDeps,
} from '../../../src/domain/engine/state-service.js'
import { JsonStorageBackend } from '../../../src/infra/storage/json-backend.js'
import {
  setStorageBackend,
  resetStorageBackend,
} from '../../../src/infra/storage/backend-instance.js'
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
import { systemClock } from '../../../src/shared/utils/clock.js'

const RUN_ID = 'test-run'

function createBackend(): JsonStorageBackend {
  return new JsonStorageBackend({
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
    clock: systemClock,
  })
}

describe('state-service', () => {
  let backend: JsonStorageBackend

  beforeEach(async () => {
    initTmpDir()
    backend = createBackend()
    setStorageBackend(backend)
    setDefaultStateServiceDeps({ storageBackend: backend })

    // Ensure run directory exists
    await ensureDir(getRunsDir())
    await ensureDir(`${getRunsDir()}/${RUN_ID}`)
  })

  afterEach(async () => {
    resetStorageBackend()
    await cleanupTmpDir()
  })

  it('readState returns empty object before init', async () => {
    const state = await readState(RUN_ID)
    expect(state).toEqual({})
  })

  it('patchState merges patch into state', async () => {
    await patchState(RUN_ID, { foo: 'bar', count: 1 })
    const state = await readState(RUN_ID)
    expect(state).toEqual({ foo: 'bar', count: 1 })
  })

  it('patchState + readState round-trip', async () => {
    await patchState(RUN_ID, { a: 1 })
    await patchState(RUN_ID, { b: 2 })
    const state = await readState(RUN_ID)
    expect(state).toEqual({ a: 1, b: 2 })
  })

  it('getStateKey returns specific key value', async () => {
    await patchState(RUN_ID, { myKey: 'myValue', other: 42 })
    const value = await getStateKey(RUN_ID, 'myKey')
    expect(value).toBe('myValue')
  })

  it('getStateKey returns undefined for missing key', async () => {
    await patchState(RUN_ID, { existing: true })
    const value = await getStateKey(RUN_ID, 'nonexistent')
    expect(value).toBeUndefined()
  })
})
