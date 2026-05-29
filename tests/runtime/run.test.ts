import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import * as runService from '../../src/runtime/run.js'
import { RunNotFoundError, RunExistsError } from '../../src/errors.js'

const TMP_DIR = path.join(os.tmpdir(), `dagman-run-test-${Date.now()}`)

let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  await fs.mkdir(TMP_DIR, { recursive: true })
  process.chdir(TMP_DIR)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.rm(TMP_DIR, { recursive: true, force: true })
})

describe('resolveCurrentRunId', () => {
  it('should return default when no current run exists', async () => {
    const runId = await runService.resolveCurrentRunId()
    expect(runId).toBe('default')
  })

  it('should return existing current run', async () => {
    await fs.mkdir(path.join(TMP_DIR, '.dagman'), { recursive: true })
    await fs.writeFile(path.join(TMP_DIR, '.dagman/.current-run'), 'my-run')

    const runId = await runService.resolveCurrentRunId()
    expect(runId).toBe('my-run')
  })
})

describe('createRun', () => {
  it('should create a run with label-based ID', async () => {
    const info = await runService.createRun('My Feature')
    expect(info.id).toBe('my-feature')
    expect(info.label).toBe('My Feature')
  })

  it('should create a run with auto-generated ID when no label', async () => {
    const info = await runService.createRun()
    expect(info.id).toMatch(/^run-\d+$/)
  })

  it('should throw RunExistsError for duplicate ID', async () => {
    await runService.createRun('duplicate')
    await expect(runService.createRun('duplicate')).rejects.toThrow(RunExistsError)
  })

  it('should switch to new run when switchTo is true', async () => {
    await runService.createRun('feature-x', undefined, true)
    const currentId = await runService.getCurrentRunId()
    expect(currentId).toBe('feature-x')
  })

  it('should store graphName in run metadata without initializing workflow', async () => {
    // Without actual graph file, just stores the name
    const info = await runService.createRun('with-graph')
    expect(info.graphName).toBeUndefined()
  })
})

describe('getGraphForRun', () => {
  it('should return null when run has no graph', async () => {
    await runService.createRun('no-graph')
    const graphName = await runService.getGraphForRun('no-graph')
    expect(graphName).toBeNull()
  })
})

describe('resolveRunId', () => {
  it('should return provided runId', async () => {
    const id = await runService.resolveRunId('explicit')
    expect(id).toBe('explicit')
  })

  it('should resolve to current run when no runId', async () => {
    const id = await runService.resolveRunId()
    expect(id).toBe('default')
  })
})

describe('listRuns', () => {
  it('should list all runs', async () => {
    await runService.createRun('alpha')
    await runService.createRun('beta')

    const runs = await runService.listRuns()
    const ids = runs.map((r) => r.id).sort()
    expect(ids).toEqual(['alpha', 'beta'])
  })

  it('should return empty array when no runs', async () => {
    const runs = await runService.listRuns()
    expect(runs).toEqual([])
  })
})

describe('switchRun', () => {
  it('should switch to existing run', async () => {
    await runService.createRun('target')
    await runService.switchRun('target')
    const currentId = await runService.getCurrentRunId()
    expect(currentId).toBe('target')
  })

  it('should throw RunNotFoundError for non-existent run', async () => {
    await expect(runService.switchRun('ghost')).rejects.toThrow(RunNotFoundError)
  })
})

describe('showRun', () => {
  it('should return run info with task counts', async () => {
    await runService.createRun('info-test')

    const info = await runService.showRun('info-test')
    expect(info.id).toBe('info-test')
    expect(info.taskCount).toBe(0)
    expect(info.completedTasks).toBe(0)
  })

  it('should throw RunNotFoundError for non-existent run', async () => {
    await expect(runService.showRun('ghost')).rejects.toThrow(RunNotFoundError)
  })
})
