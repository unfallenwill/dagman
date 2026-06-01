import { describe, it, expect, afterEach } from 'vitest'
import {
  loadConfig,
  resetConfig,
  getConfigPath,
  getConfigDir,
} from '../../../src/infra/storage/config-loader.js'
import { DEFAULT_CONFIG } from '../../../src/shared/models/config.js'

describe('config-loader', () => {
  afterEach(() => {
    resetConfig()
  })

  describe('loadConfig', () => {
    it('should return a valid ResolvedDagmanConfig', () => {
      const config = loadConfig()
      expect(config).toBeDefined()
      expect(config.storage).toBeDefined()
    })

    it('should return DEFAULT_CONFIG when no config file exists', () => {
      resetConfig()
      const config = loadConfig()
      expect(config.storage).toEqual(DEFAULT_CONFIG.storage)
    })

    it('should cache the result on first call', () => {
      resetConfig()
      const first = loadConfig()
      const second = loadConfig()
      expect(first).toBe(second)
    })
  })

  describe('resetConfig', () => {
    it('should clear cached config so next call re-reads', () => {
      const first = loadConfig()
      resetConfig()
      const second = loadConfig()
      // After reset, the object should be a fresh read (different reference)
      expect(first).not.toBe(second)
      // But the values should be equivalent
      expect(first.storage).toEqual(second.storage)
    })

    it('should allow loadConfig to be called again after reset', () => {
      loadConfig()
      resetConfig()
      const config = loadConfig()
      expect(config.storage).toEqual(DEFAULT_CONFIG.storage)
    })
  })

  describe('getConfigPath', () => {
    it('should return a path ending with config.json', () => {
      const p = getConfigPath()
      expect(p.endsWith('config.json')).toBe(true)
    })

    it('should contain .dagman directory in the path', () => {
      const p = getConfigPath()
      expect(p).toContain('.dagman')
    })
  })

  describe('getConfigDir', () => {
    it('should return a path ending with .dagman', () => {
      const d = getConfigDir()
      expect(d.endsWith('.dagman')).toBe(true)
    })

    it('should be a parent of getConfigPath', () => {
      const dir = getConfigDir()
      const file = getConfigPath()
      expect(file.startsWith(dir)).toBe(true)
    })
  })
})
