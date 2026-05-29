import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as fs from 'fs/promises'
import { initTmpDir, cleanupTmpDir } from '../../helpers/setup.js'
import {
  getCurrentRunId,
  setCurrentRunId,
  resolveCurrentRunId,
  listRunIds,
  resolveActiveRunId,
} from '../../../src/shared/utils/run-resolver.js'
import { getDagmanDir, getRunDir, getRunMetaFile, getRunsDir } from '../../../src/constants.js'
import { ensureDir } from '../../../src/utils/file.js'

describe('run-resolver', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = initTmpDir()
  })

  afterEach(async () => {
    await cleanupTmpDir()
  })

  async function createRunMeta(runId: string, status: string): Promise<void> {
    const dir = getRunDir(runId)
    await ensureDir(dir)
    await fs.writeFile(getRunMetaFile(runId), JSON.stringify({ status, id: runId }), 'utf-8')
  }

  describe('getCurrentRunId', () => {
    it('should return null when no current run file exists', async () => {
      expect(await getCurrentRunId()).toBeNull()
    })

    it('should return the stored run ID', async () => {
      await setCurrentRunId('run-abc')
      expect(await getCurrentRunId()).toBe('run-abc')
    })

    it('should return null for empty file content', async () => {
      await ensureDir(getDagmanDir())
      const currentRunPath = path.join(tmpDir, '.dagman/.current-run')
      await fs.writeFile(currentRunPath, '   ', 'utf-8')
      expect(await getCurrentRunId()).toBeNull()
    })
  })

  describe('setCurrentRunId', () => {
    it('should create the dagman directory and write the run ID', async () => {
      await setCurrentRunId('my-run')
      const content = await fs.readFile(path.join(tmpDir, '.dagman/.current-run'), 'utf-8')
      expect(content).toBe('my-run')
    })

    it('should overwrite existing run ID', async () => {
      await setCurrentRunId('first')
      await setCurrentRunId('second')
      expect(await getCurrentRunId()).toBe('second')
    })
  })

  describe('resolveCurrentRunId', () => {
    it('should return current run ID when set', async () => {
      await setCurrentRunId('run-123')
      expect(await resolveCurrentRunId()).toBe('run-123')
    })

    it('should return DEFAULT_RUN_ID when no current run', async () => {
      expect(await resolveCurrentRunId()).toBe('default')
    })
  })

  describe('listRunIds', () => {
    it('should return empty array when no runs directory exists', async () => {
      expect(await listRunIds()).toEqual([])
    })

    it('should list runs that have run.json', async () => {
      await createRunMeta('run-a', 'running')
      await createRunMeta('run-b', 'completed')
      const ids = await listRunIds()
      expect(ids.sort()).toEqual(['run-a', 'run-b'])
    })

    it('should exclude directories without run.json', async () => {
      const runsDir = getRunsDir()
      await ensureDir(path.join(runsDir, 'incomplete-run'))
      await createRunMeta('valid-run', 'success')
      const ids = await listRunIds()
      expect(ids).toEqual(['valid-run'])
    })
  })

  describe('resolveActiveRunId', () => {
    it('should return current run ID when set', async () => {
      await setCurrentRunId('my-active-run')
      expect(await resolveActiveRunId()).toBe('my-active-run')
    })

    it('should auto-resolve single running run', async () => {
      await createRunMeta('lone-runner', 'running')
      expect(await resolveActiveRunId()).toBe('lone-runner')
    })

    it('should throw when no active run found', async () => {
      await expect(resolveActiveRunId()).rejects.toThrow('No active run found')
    })

    it('should throw when multiple running runs found', async () => {
      await createRunMeta('run-1', 'running')
      await createRunMeta('run-2', 'running')
      await expect(resolveActiveRunId()).rejects.toThrow('Multiple active runs found')
    })

    it('should ignore completed runs when auto-resolving', async () => {
      await createRunMeta('done-run', 'completed')
      await createRunMeta('active-run', 'running')
      expect(await resolveActiveRunId()).toBe('active-run')
    })

    it('should ignore failed runs when auto-resolving', async () => {
      await createRunMeta('failed-run', 'failed')
      await expect(resolveActiveRunId()).rejects.toThrow('No active run found')
    })

    it('should skip runs with invalid run.json', async () => {
      const runsDir = getRunsDir()
      await ensureDir(path.join(runsDir, 'broken-run'))
      await fs.writeFile(getRunMetaFile('broken-run'), 'not-json', 'utf-8')
      await createRunMeta('good-run', 'running')
      expect(await resolveActiveRunId()).toBe('good-run')
    })
  })
})
