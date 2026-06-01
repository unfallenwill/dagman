/**
 * Singleton accessor for the active StorageBackend instance.
 *
 * Set once during composition root initialization.
 * Used by slices that need store access without going through
 * the domain DI chain (e.g., next slice for display reads).
 */

import type { StorageBackend } from '../../shared/models/storage-backend.js'

let _instance: StorageBackend | undefined

/** Set the active storage backend (called by composition root). */
export function setStorageBackend(backend: StorageBackend): void {
  _instance = backend
}

/** Get the active storage backend. Throws if not initialized. */
export function getStorageBackend(): StorageBackend {
  if (!_instance) {
    throw new Error('Storage backend not initialized. Call setStorageBackend() first.')
  }
  return _instance
}

/** Reset the singleton (for testing). */
export function resetStorageBackend(): void {
  _instance = undefined
}
