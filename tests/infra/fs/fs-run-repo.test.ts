import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as fs from 'fs/promises'
import { initTmpDir, cleanupTmpDir } from '../../helpers/setup.js'
import '../../../src/engine/default-deps.js'
import { FsRunRepository } from '../../../src/infra/fs/fs-run-repo.js'
import { NodeNotFoundError } from '../../../src/shared/errors.js'
import type { RunInfo } from '../../../src/shared/models/superstep.js'
import {
  getDagmanDir,
  getRunsDir,
  getRunMetaFile,
  getCurrentRunFilePath,
} from '../../../src/infra/fs/paths.js'

describe('FsRunRepository', () => {
  let repo: FsRunRepository

  beforeEach(() => {
    initTmpDir()
    repo = new FsRunRepository()
  })

  afterEach(async () => {
    await cleanupTmpDir()
  })

  // --- Positive cases ---

  describe('writeRunInfo + readRunInfo (round-trip)', () => {
    it('should write and read back run info', async () => {
      const info: RunInfo = {
        id: 'run-001',
        createdAt: '2025-01-15T10:30:00.000Z',
        currentStep: 0,
        status: 'idle',
      }
      await repo.writeRunInfo('run-001', info)
      const result = await repo.readRunInfo('run-001')
      expect(result).toEqual(info)
    })

    it('should preserve optional fields in round-trip', async () => {
      const info: RunInfo = {
        id: 'run-002',
        createdAt: '2025-01-15T10:30:00.000Z',
        label: 'my label',
        graphName: 'test-graph',
        currentStep: 3,
        status: 'running',
        layerAssignment: { A: 0, B: 1, C: 1 },
      }
      await repo.writeRunInfo('run-002', info)
      const result = await repo.readRunInfo('run-002')
      expect(result).toEqual(info)
    })
  })

  describe('writeCurrentRunId + readCurrentRunId (round-trip)', () => {
    it('should write and read back current run ID', async () => {
      await repo.writeCurrentRunId('run-abc')
      const result = await repo.readCurrentRunId()
      expect(result).toBe('run-abc')
    })

    it('should overwrite previous current run ID', async () => {
      await repo.writeCurrentRunId('first')
      await repo.writeCurrentRunId('second')
      const result = await repo.readCurrentRunId()
      expect(result).toBe('second')
    })
  })

  describe('listRunIds', () => {
    it('should list all valid run IDs', async () => {
      const ids = ['run-a', 'run-b', 'run-c']
      for (const id of ids) {
        const info: RunInfo = {
          id,
          createdAt: '2025-01-15T10:30:00.000Z',
          currentStep: 0,
          status: 'idle',
        }
        await repo.writeRunInfo(id, info)
      }
      const result = await repo.listRunIds()
      expect(result.sort()).toEqual(['run-a', 'run-b', 'run-c'])
    })

    it('should return empty array when runs directory is empty', async () => {
      // Create the runs dir but put nothing in it
      await fs.mkdir(path.resolve(getRunsDir()), { recursive: true })
      const result = await repo.listRunIds()
      expect(result).toEqual([])
    })

    it('should only list directories that have a run.json meta file', async () => {
      // Create one valid run
      await repo.writeRunInfo('valid-run', {
        id: 'valid-run',
        createdAt: '2025-01-15T10:30:00.000Z',
        currentStep: 0,
        status: 'idle',
      })
      // Create a directory without run.json (should be skipped)
      await fs.mkdir(path.join(path.resolve(getRunsDir()), 'invalid-run'), {
        recursive: true,
      })
      const result = await repo.listRunIds()
      expect(result).toEqual(['valid-run'])
    })
  })

  // --- Negative / edge cases ---

  describe('listRunIds (error handling)', () => {
    it('should return empty array when .dagman/runs/ does not exist', async () => {
      // Do not create .dagman/runs/ at all
      const result = await repo.listRunIds()
      expect(result).toEqual([])
    })
  })

  describe('readCurrentRunId (missing or empty file)', () => {
    it('should return null when .current-run file does not exist', async () => {
      const result = await repo.readCurrentRunId()
      expect(result).toBeNull()
    })

    it('should return null when .current-run file is empty', async () => {
      await fs.mkdir(path.resolve(getDagmanDir()), { recursive: true })
      await fs.writeFile(path.resolve(getCurrentRunFilePath()), '', 'utf-8')
      const result = await repo.readCurrentRunId()
      expect(result).toBeNull()
    })

    it('should return null when .current-run file has only whitespace', async () => {
      await fs.mkdir(path.resolve(getDagmanDir()), { recursive: true })
      await fs.writeFile(path.resolve(getCurrentRunFilePath()), '   \n\t  \n', 'utf-8')
      const result = await repo.readCurrentRunId()
      expect(result).toBeNull()
    })
  })

  describe('readRunInfo (non-existent run)', () => {
    it('should throw NodeNotFoundError for non-existent run', async () => {
      await expect(repo.readRunInfo('nonexistent')).rejects.toThrow(NodeNotFoundError)
    })

    it('should include the file path in the error message', async () => {
      await expect(repo.readRunInfo('nonexistent')).rejects.toThrow(/run\.json/)
    })
  })

  describe('writeRunInfo (directory creation)', () => {
    it('should create the run directory if it does not exist', async () => {
      const info: RunInfo = {
        id: 'auto-dir',
        createdAt: '2025-01-15T10:30:00.000Z',
        currentStep: 0,
        status: 'idle',
      }
      await repo.writeRunInfo('auto-dir', info)
      // Verify the directory and file now exist
      const metaPath = path.resolve(getRunMetaFile('auto-dir'))
      const content = await fs.readFile(metaPath, 'utf-8')
      expect(JSON.parse(content)).toEqual(info)
    })
  })

  describe('writeCurrentRunId (directory creation)', () => {
    it('should create .dagman/ directory if it does not exist', async () => {
      // Ensure .dagman does not exist yet
      const dagmanDir = path.resolve(getDagmanDir())
      await expect(fs.access(dagmanDir)).rejects.toThrow()

      await repo.writeCurrentRunId('new-run')

      // Now .dagman/ should exist and .current-run should contain the ID
      const result = await repo.readCurrentRunId()
      expect(result).toBe('new-run')
    })
  })
})
