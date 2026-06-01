/**
 * Factory function for creating StorageBackend instances.
 *
 * Reads config and dispatches to the appropriate backend constructor.
 * New backends are added by extending the switch statement.
 */

import type { BackendConfig } from '../../shared/models/config.js'
import type { StorageBackend } from '../../shared/models/storage-backend.js'
import { JsonStorageBackend } from './json-backend.js'

export interface BackendDeps {
  readonly getStateFile: (runId: string) => string
  readonly getChannelsFile: (runId: string) => string
  readonly getTasksFile: (runId: string) => string
  readonly getRunMetaFile: (runId: string) => string
  readonly getGraphFile: (runId: string) => string
  readonly getRunsDir: () => string
  readonly getDagmanDir: () => string
  readonly getCurrentRunFilePath: () => string
  readonly ensureDir: (dir: string) => Promise<void>
  readonly readJSON: <T>(path: string) => Promise<T>
  readonly writeJSON: <T>(path: string, data: T) => Promise<void>
  readonly fileExists: (path: string) => Promise<boolean>
  readonly clock: () => string
}

/**
 * Create a StorageBackend based on the given config.
 *
 * @throws Error if the backend type is unknown or not yet implemented
 */
export function createStorageBackend(config: BackendConfig, deps: BackendDeps): StorageBackend {
  switch (config.type) {
    case 'json':
      return new JsonStorageBackend(deps)
    case 'sqlite':
      throw new Error('SQLite backend is not yet implemented')
    default:
      throw new Error(`Unknown storage backend type: ${(config as BackendConfig).type}`)
  }
}
