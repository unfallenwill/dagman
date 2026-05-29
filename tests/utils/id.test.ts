import { describe, it, expect } from 'vitest'
import {
  generateInstanceId,
  parseInstanceId,
  parseNodeRef,
  sequentialIdGenerator,
  systemIdGenerator,
} from '../../src/utils/id.js'

describe('generateInstanceId', () => {
  it('should produce format <name>@<8-char-hex>', () => {
    const id = generateInstanceId('demo')
    const parts = id.split('@')
    expect(parts).toHaveLength(2)
    expect(parts[0]).toBe('demo')
    expect(parts[1]).toMatch(/^[0-9a-f]{8}$/)
  })

  it('should generate different suffixes on each call', () => {
    const a = generateInstanceId('test')
    const b = generateInstanceId('test')
    expect(a).not.toBe(b)
  })

  it('should preserve the workflow name exactly', () => {
    const id = generateInstanceId('my-complex-workflow')
    expect(id.startsWith('my-complex-workflow@')).toBe(true)
  })
})

describe('parseInstanceId', () => {
  it('should parse a valid instance ID', () => {
    const result = parseInstanceId('demo@1a2b3c4d')
    expect(result.workflowName).toBe('demo')
    expect(result.suffix).toBe('1a2b3c4d')
  })

  it('should parse instance ID with hyphens in name', () => {
    const result = parseInstanceId('my-workflow@abcdef12')
    expect(result.workflowName).toBe('my-workflow')
    expect(result.suffix).toBe('abcdef12')
  })

  it('should throw for ID without @', () => {
    expect(() => parseInstanceId('no-at-sign')).toThrow('invalid instance ID')
  })

  it('should throw for empty string', () => {
    expect(() => parseInstanceId('')).toThrow('invalid instance ID')
  })

  it('should handle multiple @ signs (splits on first)', () => {
    const result = parseInstanceId('a@b@c')
    expect(result.workflowName).toBe('a')
    expect(result.suffix).toBe('b@c')
  })
})

describe('parseNodeRef', () => {
  it('should parse a valid node reference', () => {
    const result = parseNodeRef('classify@abc123')
    expect(result.nodeName).toBe('classify')
    expect(result.instanceSuffix).toBe('abc123')
  })

  it('should split on last @ (lastIndexOf)', () => {
    const result = parseNodeRef('ns@classify@abc123')
    expect(result.nodeName).toBe('ns@classify')
    expect(result.instanceSuffix).toBe('abc123')
  })

  it('should throw for ref without @', () => {
    expect(() => parseNodeRef('no-ref')).toThrow('invalid node reference')
  })

  it('should throw for empty string', () => {
    expect(() => parseNodeRef('')).toThrow('invalid node reference')
  })
})

describe('sequentialIdGenerator', () => {
  it('should produce predictable sequential IDs', () => {
    const gen = sequentialIdGenerator('test')
    expect(gen()).toBe('test-0000')
    expect(gen()).toBe('test-0001')
    expect(gen()).toBe('test-0002')
  })

  it('should use custom prefix', () => {
    const gen = sequentialIdGenerator('run')
    expect(gen()).toBe('run-0000')
    expect(gen()).toBe('run-0001')
  })

  it('should default to "test" prefix', () => {
    const gen = sequentialIdGenerator()
    expect(gen()).toBe('test-0000')
  })

  it('should pad numbers to 4 digits', () => {
    const gen = sequentialIdGenerator('id')
    // Generate enough to check padding still works
    for (let i = 0; i < 10; i++) gen()
    expect(gen()).toBe('id-0010')
  })

  it('should create independent generators', () => {
    const genA = sequentialIdGenerator('a')
    const genB = sequentialIdGenerator('b')
    expect(genA()).toBe('a-0000')
    expect(genB()).toBe('b-0000')
    expect(genA()).toBe('a-0001')
    expect(genB()).toBe('b-0001')
  })
})

describe('systemIdGenerator', () => {
  it('should return 8-char hex strings', () => {
    const id = systemIdGenerator()
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('should return unique values on subsequent calls', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 20; i++) {
      ids.add(systemIdGenerator())
    }
    expect(ids.size).toBe(20)
  })
})
