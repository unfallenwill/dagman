import { describe, it, expect, afterEach } from 'vitest'
import * as path from 'path'
import { applyWorkflowsDir, resetWorkflowsDir } from '../../src/engine/default-deps.js'
import { compile } from '../../src/domain/compiler/compiler.js'
import { listWorkflows } from '../../src/domain/workflow/workflow-discovery.js'

describe('applyWorkflowsDir', () => {
  // Restore original DI defaults after each test to prevent state leakage
  afterEach(() => {
    resetWorkflowsDir()
  })

  describe('compiler DI override', () => {
    it('should re-wire getWorkflowTsFile to resolve against custom directory', async () => {
      applyWorkflowsDir('/custom/wf-dir')

      let capturedPath = ''
      await compile('test-workflow', {
        loader: {
          load: async (p: string) => {
            capturedPath = p
            return {
              name: 'test-workflow',
              stateSchema: { x: 0 },
              nodes: [{ name: 'A', fn: () => ({ x: 1 }) }],
              edges: [],
            }
          },
        },
      })

      expect(capturedPath).toBe(path.resolve('/custom/wf-dir/test-workflow/index.ts'))
    })

    it('should reject path traversal in workflow name', async () => {
      applyWorkflowsDir('/custom')

      await expect(
        compile('../etc/passwd', {
          loader: {
            load: async () => ({
              name: 'x',
              stateSchema: { x: 0 },
              nodes: [{ name: 'A', fn: () => ({}) }],
              edges: [],
            }),
          },
        }),
      ).rejects.toThrow('invalid workflow path')
    })
  })

  describe('discovery DI override', () => {
    it('should re-wire getWorkflowsDirs to return custom directory', async () => {
      applyWorkflowsDir('/custom/wf-dir')

      let scannedDir = ''
      await listWorkflows({
        readdir: async (dir: string) => {
          scannedDir = dir
          return []
        },
        loader: {
          load: async () => ({
            name: 'x',
            stateSchema: { x: 0 },
            nodes: [{ name: 'A', fn: () => ({}) }],
            edges: [],
          }),
        },
        getWorkflowTsFile: () => '/x/index.ts',
      })

      expect(scannedDir).toBe('/custom/wf-dir')
    })
  })

  describe('no-op cases', () => {
    it('should be a no-op when dir is undefined', () => {
      expect(() => applyWorkflowsDir(undefined)).not.toThrow()
    })

    it('should be a no-op when dir is empty string', () => {
      expect(() => applyWorkflowsDir('')).not.toThrow()
    })
  })

  describe('resetWorkflowsDir', () => {
    it('should restore original DI defaults after override', async () => {
      applyWorkflowsDir('/override-dir')
      resetWorkflowsDir()

      // After reset, getWorkflowTsFile should use the original path resolution
      let capturedPath = ''
      await compile('test-wf', {
        loader: {
          load: async (p: string) => {
            capturedPath = p
            return {
              name: 'test-wf',
              stateSchema: { x: 0 },
              nodes: [{ name: 'A', fn: () => ({ x: 1 }) }],
              edges: [],
            }
          },
        },
      })

      // Should resolve via the original resolveWorkflowPathSync (contains .dagman/workflows)
      expect(capturedPath).toContain('.dagman/workflows')
    })
  })
})
