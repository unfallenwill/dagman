import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as fs from 'fs/promises'
import { initTmpDir, cleanupTmpDir } from '../helpers/setup.js'
import {
  ensureDir,
  readJSON,
  writeJSON,
  readYAML,
  fileExists,
  deleteFile,
  listFiles,
} from '../../src/utils/file.js'
import { NodeNotFoundError, ValidationError } from '../../src/shared/errors.js'

describe('file utilities', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = initTmpDir()
  })

  afterEach(async () => {
    await cleanupTmpDir()
  })

  describe('ensureDir', () => {
    it('should create a single directory', async () => {
      const dir = path.join(tmpDir, 'single')
      await ensureDir(dir)
      await expect(fs.access(dir)).resolves.toBeUndefined()
    })

    it('should create nested directories', async () => {
      const dir = path.join(tmpDir, 'a', 'b', 'c')
      await ensureDir(dir)
      await expect(fs.access(dir)).resolves.toBeUndefined()
    })

    it('should not throw if directory already exists', async () => {
      const dir = path.join(tmpDir, 'existing')
      await fs.mkdir(dir)
      await expect(ensureDir(dir)).resolves.toBeUndefined()
    })
  })

  describe('writeJSON + readJSON', () => {
    it('should write and read back JSON data', async () => {
      const filePath = path.join(tmpDir, 'data.json')
      const data = { name: 'test', count: 42, nested: { key: 'value' } }
      await writeJSON(filePath, data)
      const result = await readJSON<typeof data>(filePath)
      expect(result).toEqual(data)
    })

    it('should write formatted JSON with trailing newline', async () => {
      const filePath = path.join(tmpDir, 'formatted.json')
      await writeJSON(filePath, { a: 1 })
      const raw = await fs.readFile(filePath, 'utf-8')
      expect(raw).toBe('{\n  "a": 1\n}\n')
    })

    it('should create parent directories when writing', async () => {
      const filePath = path.join(tmpDir, 'deep', 'nested', 'data.json')
      await writeJSON(filePath, { ok: true })
      const result = await readJSON<{ ok: boolean }>(filePath)
      expect(result.ok).toBe(true)
    })
  })

  describe('readJSON', () => {
    it('should throw NodeNotFoundError for non-existent file', async () => {
      const filePath = path.join(tmpDir, 'missing.json')
      await expect(readJSON(filePath)).rejects.toThrow(NodeNotFoundError)
    })

    it('should throw NodeNotFoundError with file path in message', async () => {
      const filePath = path.join(tmpDir, 'missing.json')
      await expect(readJSON(filePath)).rejects.toThrow(/node '.*missing\.json' not found/)
    })

    it('should throw ValidationError for invalid JSON', async () => {
      const filePath = path.join(tmpDir, 'bad.json')
      await fs.writeFile(filePath, '{invalid json content', 'utf-8')
      await expect(readJSON(filePath)).rejects.toThrow(ValidationError)
    })

    it('should throw ValidationError with descriptive message', async () => {
      const filePath = path.join(tmpDir, 'bad.json')
      await fs.writeFile(filePath, 'not json', 'utf-8')
      await expect(readJSON(filePath)).rejects.toThrow('is not valid JSON')
    })
  })

  describe('readYAML', () => {
    it('should read a valid YAML file', async () => {
      const filePath = path.join(tmpDir, 'data.yaml')
      await fs.writeFile(filePath, 'name: test\ncount: 42\n', 'utf-8')
      const result = await readYAML<{ name: string; count: number }>(filePath)
      expect(result).toEqual({ name: 'test', count: 42 })
    })

    it('should read YAML with nested structures', async () => {
      const filePath = path.join(tmpDir, 'nested.yaml')
      await fs.writeFile(filePath, 'items:\n  - one\n  - two\nnested:\n  key: value\n', 'utf-8')
      const result = await readYAML<{
        items: string[]
        nested: { key: string }
      }>(filePath)
      expect(result.items).toEqual(['one', 'two'])
      expect(result.nested.key).toBe('value')
    })

    it('should throw NodeNotFoundError for non-existent file', async () => {
      const filePath = path.join(tmpDir, 'missing.yaml')
      await expect(readYAML(filePath)).rejects.toThrow(NodeNotFoundError)
    })

    it('should throw ValidationError for invalid YAML', async () => {
      const filePath = path.join(tmpDir, 'bad.yaml')
      await fs.writeFile(filePath, ':\n  :\n  - [\n', 'utf-8')
      await expect(readYAML(filePath)).rejects.toThrow(ValidationError)
    })
  })

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      const filePath = path.join(tmpDir, 'exists.txt')
      await fs.writeFile(filePath, 'content', 'utf-8')
      expect(await fileExists(filePath)).toBe(true)
    })

    it('should return false for non-existent file', async () => {
      const filePath = path.join(tmpDir, 'nope.txt')
      expect(await fileExists(filePath)).toBe(false)
    })

    it('should return true for existing directory', async () => {
      expect(await fileExists(tmpDir)).toBe(true)
    })
  })

  describe('deleteFile', () => {
    it('should delete an existing file', async () => {
      const filePath = path.join(tmpDir, 'deleteme.txt')
      await fs.writeFile(filePath, 'content', 'utf-8')
      await deleteFile(filePath)
      expect(await fileExists(filePath)).toBe(false)
    })

    it('should silently ignore ENOENT (file not found)', async () => {
      const filePath = path.join(tmpDir, 'already-gone.txt')
      await expect(deleteFile(filePath)).resolves.toBeUndefined()
    })
  })

  describe('listFiles', () => {
    it('should list files by extension', async () => {
      await fs.writeFile(path.join(tmpDir, 'a.json'), '{}', 'utf-8')
      await fs.writeFile(path.join(tmpDir, 'b.json'), '{}', 'utf-8')
      await fs.writeFile(path.join(tmpDir, 'c.yaml'), 'x: 1', 'utf-8')
      const result = await listFiles(tmpDir, '.json')
      expect(result.sort()).toEqual(['a.json', 'b.json'])
    })

    it('should return empty array for non-existent directory', async () => {
      const result = await listFiles(path.join(tmpDir, 'no-such-dir'))
      expect(result).toEqual([])
    })

    it('should use .json as default extension', async () => {
      await fs.writeFile(path.join(tmpDir, 'data.json'), '{}', 'utf-8')
      await fs.writeFile(path.join(tmpDir, 'data.txt'), 'text', 'utf-8')
      const result = await listFiles(tmpDir)
      expect(result).toEqual(['data.json'])
    })

    it('should return empty array for directory with no matching files', async () => {
      await fs.writeFile(path.join(tmpDir, 'data.txt'), 'text', 'utf-8')
      const result = await listFiles(tmpDir, '.yaml')
      expect(result).toEqual([])
    })
  })
})
