import { describe, it, expect } from 'vitest'
import { createStorageBackend } from '../../../src/infra/storage/backend-factory.js'
import type { BackendDeps } from '../../../src/infra/storage/backend-factory.js'

const mockDeps: BackendDeps = {
  getStateFile: (runId: string) => `/tmp/${runId}/state.json`,
  getChannelsFile: (runId: string) => `/tmp/${runId}/channels.json`,
  getTasksFile: (runId: string) => `/tmp/${runId}/tasks.json`,
  getRunMetaFile: (runId: string) => `/tmp/${runId}/meta.json`,
  getGraphFile: (runId: string) => `/tmp/${runId}/graph.json`,
  getRunsDir: () => '/tmp/runs',
  getDagmanDir: () => '/tmp/.dagman',
  getCurrentRunFilePath: () => '/tmp/.dagman/current-run',
  ensureDir: async () => {},
  readJSON: async <T>() => ({}) as T,
  writeJSON: async () => {},
  fileExists: async () => false,
  clock: () => '2026-01-15T12:00:00.000Z',
}

describe('backend-factory', () => {
  it('should create a JsonStorageBackend for type json', () => {
    const backend = createStorageBackend({ type: 'json' }, mockDeps)
    expect(backend).toBeDefined()
  })

  it('should throw "not yet implemented" for type sqlite', () => {
    expect(() => createStorageBackend({ type: 'sqlite' }, mockDeps)).toThrow(
      'SQLite backend is not yet implemented',
    )
  })

  it('should throw "Unknown storage backend type" for unknown type', () => {
    expect(() => createStorageBackend({ type: 'unknown' } as any, mockDeps)).toThrow(
      'Unknown storage backend type: unknown',
    )
  })
})
