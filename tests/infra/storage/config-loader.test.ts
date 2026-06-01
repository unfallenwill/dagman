import { describe, it, expect, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'fs'
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
    const configPath = getConfigPath()
    if (existsSync(configPath)) {
      unlinkSync(configPath)
    }
    const configDir = getConfigDir()
    if (existsSync(configDir)) {
      rmSync(configDir, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
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

  describe('loadConfig with malformed config file', () => {
    it('should return defaults and warn when config file has malformed JSON', () => {
      const configPath = getConfigPath()
      const configDir = getConfigDir()
      mkdirSync(configDir, { recursive: true })
      writeFileSync(configPath, '{ invalid json !!!', 'utf-8')

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const config = loadConfig()

      expect(config.storage).toEqual(DEFAULT_CONFIG.storage)
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(warnSpy.mock.calls[0]![0]).toContain('failed to parse')
    })

    it('should return defaults and warn when config file has non-JSON content', () => {
      const configPath = getConfigPath()
      const configDir = getConfigDir()
      mkdirSync(configDir, { recursive: true })
      writeFileSync(configPath, 'this is not json at all', 'utf-8')

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const config = loadConfig()

      expect(config.storage).toEqual(DEFAULT_CONFIG.storage)
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(warnSpy.mock.calls[0]![0]).toContain('failed to parse')
    })
  })
})
