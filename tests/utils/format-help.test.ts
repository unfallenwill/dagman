import { describe, it, expect } from 'vitest'
import { Command } from 'commander'
import { formatManHelp } from '../../src/utils/format-help.js'
import { setCommandMeta } from '../../src/utils/command-meta.js'

describe('formatManHelp', () => {
  it('should return empty string for command without meta', () => {
    const cmd = new Command('test')
    expect(formatManHelp(cmd)).toBe('')
  })

  it('should format examples section', () => {
    const cmd = new Command('test')
    setCommandMeta(cmd, {
      examples: [
        { description: 'Start a workflow', command: 'dagman start demo' },
        { description: 'List runs', command: 'dagman list' },
      ],
      exitStatus: [],
      seeAlso: [],
      dataProducing: false,
    })
    const result = formatManHelp(cmd)
    expect(result).toContain('Examples:')
    expect(result).toContain('Start a workflow:')
    expect(result).toContain('$ dagman start demo')
    expect(result).toContain('List runs:')
    expect(result).toContain('$ dagman list')
  })

  it('should format exit status section', () => {
    const cmd = new Command('test')
    setCommandMeta(cmd, {
      examples: [],
      exitStatus: [
        { code: 0, meaning: 'Success' },
        { code: 1, meaning: 'Failure' },
      ],
      seeAlso: [],
      dataProducing: false,
    })
    const result = formatManHelp(cmd)
    expect(result).toContain('Exit Status:')
    expect(result).toContain('0  Success')
    expect(result).toContain('1  Failure')
  })

  it('should format see also section', () => {
    const cmd = new Command('test')
    setCommandMeta(cmd, {
      examples: [],
      exitStatus: [],
      seeAlso: ['dagman-start(1)', 'dagman-list(1)'],
      dataProducing: false,
    })
    const result = formatManHelp(cmd)
    expect(result).toContain('See Also:')
    expect(result).toContain('dagman-start(1), dagman-list(1)')
  })

  it('should format all sections together', () => {
    const cmd = new Command('test')
    setCommandMeta(cmd, {
      examples: [{ description: 'Run it', command: 'dagman run' }],
      exitStatus: [{ code: 0, meaning: 'OK' }],
      seeAlso: ['dagman-other(1)'],
      dataProducing: true,
    })
    const result = formatManHelp(cmd)
    expect(result).toContain('Examples:')
    expect(result).toContain('Exit Status:')
    expect(result).toContain('See Also:')
  })

  it('should omit sections when arrays are empty', () => {
    const cmd = new Command('test')
    setCommandMeta(cmd, {
      examples: [],
      exitStatus: [{ code: 0, meaning: 'OK' }],
      seeAlso: [],
      dataProducing: false,
    })
    const result = formatManHelp(cmd)
    expect(result).toContain('Exit Status:')
    expect(result).not.toContain('Examples:')
    expect(result).not.toContain('See Also:')
  })
})
