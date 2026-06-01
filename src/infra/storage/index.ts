/**
 * Storage module public API.
 *
 * Re-exports the main entry points for creating and accessing storage backends.
 */

export { JsonStorageBackend } from './json-backend.js'
export { createStorageBackend } from './backend-factory.js'
export type { BackendDeps } from './backend-factory.js'
export { loadConfig, resetConfig, getConfigPath, getConfigDir } from './config-loader.js'
export { setStorageBackend, getStorageBackend, resetStorageBackend } from './backend-instance.js'
