import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as fs from 'fs/promises'
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
  getWorkflowManifest,
  getGraphsDir,
  getCurrentRunFilePath,
  getWorkflowEntryFile,
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

    it('should return graphs dir under custom basePath', () => {
      setBasePath('/custom')
      expect(getGraphsDir()).toBe(path.join('/custom', '.dagman', 'graphs'))
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

    it('should return workflow manifest ending in manifest.yaml', () => {
      setBasePath(tmpDir)
      const result = getWorkflowManifest('demo')
      expect(result).toBe(path.join(tmpDir, '.dagman', 'workflows', 'demo', 'manifest.yaml'))
      expect(result.endsWith('manifest.yaml')).toBe(true)
    })
  })

  describe('getWorkflowEntryFile', () => {
    it('should return TS path when index.ts exists', async () => {
      const wfDir = path.join(tmpDir, '.dagman', 'workflows', 'demo')
      await fs.mkdir(wfDir, { recursive: true })
      await fs.writeFile(path.join(wfDir, 'index.ts'), '', 'utf-8')

      const result = await getWorkflowEntryFile('demo')
      expect(result).toBe(getWorkflowTsFile('demo'))
      expect(result.endsWith('/index.ts')).toBe(true)
    })

    it('should return JS path when index.ts does not exist but index.js does', async () => {
      const wfDir = path.join(tmpDir, '.dagman', 'workflows', 'demo')
      await fs.mkdir(wfDir, { recursive: true })
      await fs.writeFile(path.join(wfDir, 'index.js'), '', 'utf-8')

      const result = await getWorkflowEntryFile('demo')
      expect(result.endsWith('/index.js')).toBe(true)
    })

    it('should return JS path (default fallback) when neither index.ts nor index.js exists', async () => {
      // Do not create any workflow directory or files
      const result = await getWorkflowEntryFile('demo')
      expect(result.endsWith('/index.js')).toBe(true)
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
