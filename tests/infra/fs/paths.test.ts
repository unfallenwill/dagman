import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import { initTmpDir, cleanupTmpDir } from '../../helpers/setup.js'
import {
  setBasePath,
  getBasePath,
  getDagmanDir,
  getRunsDir,
  getRunDir,
  getRunMetaFile,
  getWorkflowJsonlFile,
  getEventsFile,
  getWorkflowDir,
  getWorkflowTsFile,
  getCurrentRunFilePath,
} from '../../../src/infra/fs/paths.js'

describe('paths', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = initTmpDir()
  })

  afterEach(async () => {
    await cleanupTmpDir()
  })

  describe('directory-level resolvers with basePath', () => {
    it('should return .dagman dir under custom basePath', () => {
      setBasePath('/custom')
      expect(getDagmanDir()).toBe(path.join('/custom', '.dagman'))
    })

    it('should return runs dir under custom basePath', () => {
      setBasePath('/custom')
      expect(getRunsDir()).toBe(path.join('/custom', '.dagman', 'runs'))
    })

    it('should return current-run file path under custom basePath', () => {
      setBasePath('/custom')
      expect(getCurrentRunFilePath()).toBe(path.join('/custom', '.dagman', '.current-run'))
    })
  })

  describe('run-aware path resolvers with basePath', () => {
    it('should return run dir for a given runId', () => {
      setBasePath('/custom')
      expect(getRunDir('myrun')).toBe(path.join('/custom', '.dagman', 'runs', 'myrun'))
    })

    it('should return run meta file for a given runId', () => {
      setBasePath('/custom')
      expect(getRunMetaFile('myrun')).toBe(
        path.join('/custom', '.dagman', 'runs', 'myrun', 'run.json'),
      )
    })

    it('should return workflow jsonl file for a given runId', () => {
      setBasePath(tmpDir)
      const result = getWorkflowJsonlFile('myrun')
      expect(result).toBe(path.join(tmpDir, '.dagman', 'runs', 'myrun', 'workflow.jsonl'))
    })

    it('should return events file for a given runId', () => {
      setBasePath(tmpDir)
      const result = getEventsFile('myrun')
      expect(result).toBe(path.join(tmpDir, '.dagman', 'runs', 'myrun', 'events.jsonl'))
    })
  })

  describe('workflow path resolvers with basePath', () => {
    it('should return workflow dir for a named workflow', () => {
      setBasePath(tmpDir)
      const result = getWorkflowDir('demo')
      expect(result).toBe(path.join(tmpDir, '.dagman', 'workflows', 'demo'))
    })

    it('should return workflow TS file ending in /index.ts', () => {
      setBasePath(tmpDir)
      const result = getWorkflowTsFile('demo')
      expect(result).toBe(path.join(tmpDir, '.dagman', 'workflows', 'demo', 'index.ts'))
      expect(result.endsWith('/index.ts')).toBe(true)
    })
  })

  describe('default basePath behavior', () => {
    it('should return relative .dagman path when basePath is empty', () => {
      setBasePath('')
      expect(getDagmanDir()).toBe('.dagman')
    })

    it('should return relative runs path when basePath is empty', () => {
      setBasePath('')
      expect(getRunsDir()).toBe('.dagman/runs')
    })

    it('should return relative current-run file path when basePath is empty', () => {
      setBasePath('')
      expect(getCurrentRunFilePath()).toBe('.dagman/.current-run')
    })

    it('should handle basePath set to empty string for relative paths', () => {
      setBasePath('')
      expect(getRunDir('abc')).toBe('.dagman/runs/abc')
      expect(getRunMetaFile('abc')).toBe('.dagman/runs/abc/run.json')
      expect(getWorkflowDir('myflow')).toBe('.dagman/workflows/myflow')
    })
  })

  describe('getBasePath', () => {
    it('should return the currently set basePath', () => {
      setBasePath('/some/path')
      expect(getBasePath()).toBe('/some/path')
    })

    it('should return empty string after reset', () => {
      setBasePath('/something')
      setBasePath('')
      expect(getBasePath()).toBe('')
    })
  })
})
