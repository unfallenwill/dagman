import { describe, it, expect, afterEach } from 'vitest'
import {
  setStorageBackend,
  getStorageBackend,
  resetStorageBackend,
} from '../../../src/infra/storage/backend-instance.js'
import type { StorageBackend } from '../../../src/shared/models/storage-backend.js'

function createMockBackend(): StorageBackend {
  return {} as StorageBackend
}

describe('backend-instance', () => {
  afterEach(() => {
    resetStorageBackend()
  })

  it('should throw when getStorageBackend is called before setStorageBackend', () => {
    expect(() => getStorageBackend()).toThrow('Storage backend not initialized')
  })

  it('should return the backend after setStorageBackend is called', () => {
    const backend = createMockBackend()
    setStorageBackend(backend)
    expect(getStorageBackend()).toBe(backend)
  })

  it('should return the same instance on repeated getStorageBackend calls', () => {
    const backend = createMockBackend()
    setStorageBackend(backend)
    expect(getStorageBackend()).toBe(getStorageBackend())
  })

  it('should clear the instance after resetStorageBackend', () => {
    const backend = createMockBackend()
    setStorageBackend(backend)
    expect(getStorageBackend()).toBe(backend)

    resetStorageBackend()
    expect(() => getStorageBackend()).toThrow('Storage backend not initialized')
  })
})
