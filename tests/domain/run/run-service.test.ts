import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../../../src/engine/default-deps.js'
import { initTmpDir, cleanupTmpDir } from '../../helpers/setup.js'
import {
  createRun,
  listRuns,
  switchRun,
  getGraphForRun,
  resolveRunId,
  runExists,
  showRun,
} from '../../../src/domain/run/run-service.js'
import { setCurrentRunId } from '../../../src/domain/run/run-resolver.js'
import { setDefaultEngineDeps } from '../../../src/domain/engine/execution-engine.js'
import { RunNotFoundError } from '../../../src/shared/errors.js'
import type { CompiledGraph } from '../../../src/shared/models/compiled-graph.js'

// ── Helpers ────────────────────────────────────────────────────────────

function buildMinimalGraph(name = 'test-graph'): CompiledGraph {
  return {
    name,
    nodes: {
      A: { id: 'A', fn: () => ({}), strategies: [], triggeredBy: 'entry:A' },
    },
    stateSchema: {},
    channels: {},
    layers: [['A']],
  }
}

function mockCompileWorkflow(graph: CompiledGraph) {
  setDefaultEngineDeps({
    compileWorkflow: async (n: string) => {
      if (n === graph.name) return graph
      throw new Error(`unknown graph '${n}'`)
    },
  })
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('run-service', () => {
  beforeEach(() => {
    initTmpDir()
  })

  afterEach(async () => {
    await cleanupTmpDir()
  })

  describe('listRuns', () => {
    it('should return empty array when no runs exist', async () => {
      const runs = await listRuns()
      expect(runs).toEqual([])
    })

    it('should return created runs sorted by createdAt', async () => {
      const graph1 = buildMinimalGraph('graph-a')
      const graph2 = buildMinimalGraph('graph-b')
      mockCompileWorkflow(graph1)

      const run1 = await createRun(undefined, undefined, false, undefined, graph1)
      expect(run1).toBeDefined()
      expect(run1.graphName).toBe('graph-a')

      mockCompileWorkflow(graph2)
      const run2 = await createRun(undefined, undefined, false, undefined, graph2)
      expect(run2).toBeDefined()
      expect(run2.graphName).toBe('graph-b')

      const runs = await listRuns()
      expect(runs).toHaveLength(2)
      expect(runs.map((r) => r.graphName)).toEqual(['graph-a', 'graph-b'])
    })
  })

  describe('createRun', () => {
    it('should create a run and return RunInfo', async () => {
      const graph = buildMinimalGraph()
      mockCompileWorkflow(graph)

      const info = await createRun(undefined, undefined, false, undefined, graph)

      expect(info).toMatchObject({
        graphName: 'test-graph',
        currentStep: 0,
        currentStepScheduled: false,
        status: 'running',
      })
      expect(info.id).toBeTruthy()
      expect(info.createdAt).toBeTruthy()
    })

    it('should use explicitRunId when provided', async () => {
      const graph = buildMinimalGraph()
      mockCompileWorkflow(graph)

      const info = await createRun(undefined, undefined, false, 'my-custom-id', graph)

      expect(info.id).toBe('my-custom-id')
    })

    it('should switch to the run when switchTo is true', async () => {
      const graph = buildMinimalGraph()
      mockCompileWorkflow(graph)

      const info = await createRun(undefined, undefined, true, 'switch-test-run', graph)

      expect(info.id).toBe('switch-test-run')
      // Verify it became the current run
      const resolved = await resolveRunId(undefined)
      expect(resolved).toBe('switch-test-run')
    })

    it('should throw if compiledGraph is not provided', async () => {
      await expect(
        createRun(undefined, undefined, false, undefined, undefined as never),
      ).rejects.toThrow('compiledGraph is required')
    })
  })

  describe('runExists', () => {
    it('should return true for an existing run', async () => {
      const graph = buildMinimalGraph()
      mockCompileWorkflow(graph)
      const info = await createRun(undefined, undefined, false, 'exist-test', graph)

      expect(await runExists(info.id)).toBe(true)
    })

    it('should return false for a non-existent run', async () => {
      expect(await runExists('nonexistent-run')).toBe(false)
    })
  })

  describe('switchRun', () => {
    it('should switch current run', async () => {
      const graph = buildMinimalGraph()
      mockCompileWorkflow(graph)
      await createRun(undefined, undefined, false, 'switch-target', graph)

      await switchRun('switch-target')

      const resolved = await resolveRunId(undefined)
      expect(resolved).toBe('switch-target')
    })

    it('should throw RunNotFoundError for non-existent run', async () => {
      await expect(switchRun('no-such-run')).rejects.toThrow(RunNotFoundError)
      await expect(switchRun('no-such-run')).rejects.toThrow("run 'no-such-run' not found")
    })
  })

  describe('getGraphForRun', () => {
    it('should return graph name for a run', async () => {
      const graph = buildMinimalGraph('my-graph')
      mockCompileWorkflow(graph)
      await createRun(undefined, undefined, false, 'graph-lookup-run', graph)

      const graphName = await getGraphForRun('graph-lookup-run')
      expect(graphName).toBe('my-graph')
    })

    it('should return null when run has no graphName', async () => {
      // Create a run meta manually without graphName
      const { getRunDir, getRunMetaFile } = await import('../../../src/infra/fs/paths.js')
      const { ensureDir } = await import('../../../src/infra/fs/file-ops.js')
      const fs = await import('fs/promises')
      const dir = getRunDir('no-graph-run')
      await ensureDir(dir)
      await fs.writeFile(
        getRunMetaFile('no-graph-run'),
        JSON.stringify({
          id: 'no-graph-run',
          createdAt: '2026-01-01',
          currentStep: 0,
          currentStepScheduled: false,
          status: 'running',
        }),
        'utf-8',
      )

      const result = await getGraphForRun('no-graph-run')
      expect(result).toBeNull()
    })
  })

  describe('resolveRunId', () => {
    it('should return provided ID directly', async () => {
      const result = await resolveRunId('provided-id')
      expect(result).toBe('provided-id')
    })

    it('should resolve current run ID when no ID provided', async () => {
      await setCurrentRunId('current-run')
      const result = await resolveRunId(undefined)
      expect(result).toBe('current-run')
    })
  })

  describe('showRun', () => {
    it('should return run info with task counts', async () => {
      const graph = buildMinimalGraph()
      mockCompileWorkflow(graph)
      await createRun(undefined, undefined, false, 'show-test-run', graph)

      const info = await showRun('show-test-run')

      expect(info).toMatchObject({
        id: 'show-test-run',
        graphName: 'test-graph',
        currentStep: 0,
        currentStepScheduled: false,
        status: 'running',
        taskCount: 0,
        completedTasks: 0,
      })
    })

    it('should throw RunNotFoundError for non-existent run', async () => {
      await expect(showRun('no-such-run')).rejects.toThrow(RunNotFoundError)
      await expect(showRun('no-such-run')).rejects.toThrow("run 'no-such-run' not found")
    })
  })
})
