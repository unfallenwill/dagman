import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../../../src/engine/default-deps.js'
import { initTmpDir, cleanupTmpDir } from '../../helpers/setup.js'
import {
  triggerChannel,
  barrierWrite,
  readChannel,
  setDefaultChannelServiceDeps,
} from '../../../src/domain/engine/channel-service.js'
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

describe('channel-service', () => {
  let backend: JsonStorageBackend

  beforeEach(async () => {
    initTmpDir()
    backend = createBackend()
    setStorageBackend(backend)
    setDefaultChannelServiceDeps({ storageBackend: backend })

    // Ensure run directory exists and initialize channels
    await ensureDir(getRunsDir())
    await ensureDir(`${getRunsDir()}/${RUN_ID}`)
  })

  afterEach(async () => {
    resetStorageBackend()
    await cleanupTmpDir()
  })

  it('triggerChannel increments trigger channel version', async () => {
    await backend.initChannels(RUN_ID, {
      'trigger:A': { type: 'trigger' },
    })

    const before = await readChannel(RUN_ID, 'trigger:A')
    expect(before?.version).toBe(0)

    await triggerChannel(RUN_ID, 'trigger:A')

    const after = await readChannel(RUN_ID, 'trigger:A')
    expect(after?.version).toBe(1)
  })

  it('barrierWrite returns false for partial write, true when all writers done', async () => {
    await backend.initChannels(RUN_ID, {
      'barrier:B': { type: 'barrier', writers: ['w1', 'w2'] },
    })

    const partial = await barrierWrite(RUN_ID, 'barrier:B', 'w1')
    expect(partial).toBe(false)

    const complete = await barrierWrite(RUN_ID, 'barrier:B', 'w2')
    expect(complete).toBe(true)

    const ch = await readChannel(RUN_ID, 'barrier:B')
    expect(ch?.version).toBe(1)
    expect(ch?.type).toBe('barrier')
    if (ch?.type === 'barrier') {
      expect(ch.received).toEqual(['w1', 'w2'])
    }
  })

  it('readChannel returns channel data', async () => {
    await backend.initChannels(RUN_ID, {
      'trigger:X': { type: 'trigger' },
    })

    const ch = await readChannel(RUN_ID, 'trigger:X')
    expect(ch).not.toBeNull()
    expect(ch?.name).toBe('trigger:X')
    expect(ch?.type).toBe('trigger')
    expect(ch?.version).toBe(0)
  })

  it('readChannel returns null for non-existent channel', async () => {
    await backend.initChannels(RUN_ID, {})

    const ch = await readChannel(RUN_ID, 'no-such-channel')
    expect(ch).toBeNull()
  })
})
