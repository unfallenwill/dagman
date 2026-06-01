import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createProgram } from '../../src/engine/cli.js'

describe('help command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('should show overview with corrected workflow steps', async () => {
    const program = createProgram()
    program.exitOverride()
    program.configureOutput({ writeErr: () => {} })

    await program.parseAsync(['node', 'dagman', 'help'])

    const fullOutput = logSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
    // Should reference actual commands
    expect(fullOutput).toContain('dagman start')
    expect(fullOutput).toContain('dagman next')
    // Should NOT reference removed commands
    expect(fullOutput).not.toContain('dagman collect')
    expect(fullOutput).not.toContain('dagman run create')
    expect(fullOutput).not.toContain('dagman task start')
    expect(fullOutput).not.toContain('dagman task complete')
  })

  it('should show Discovery group in command reference', async () => {
    const program = createProgram()
    program.exitOverride()
    program.configureOutput({ writeErr: () => {} })

    await program.parseAsync(['node', 'dagman', 'help'])

    const fullOutput = logSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
    expect(fullOutput).toContain('Discovery:')
    expect(fullOutput).toContain('Execution:')
    expect(fullOutput).toContain('Scheduling:')
  })

  it('should not show phantom commands in reference', async () => {
    const program = createProgram()
    program.exitOverride()
    program.configureOutput({ writeErr: () => {} })

    await program.parseAsync(['node', 'dagman', 'help'])

    const fullOutput = logSpy.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n')
    const referenceSection = fullOutput.slice(fullOutput.indexOf('Command Reference'))
    expect(referenceSection).not.toContain('compile')
    expect(referenceSection).not.toContain('graph')
    // Verify only 7 actual commands appear (not phantom 'task' as standalone command)
    const commandLines = referenceSection
      .split('\n')
      .filter((line: string) => line.trim().startsWith('dagman') || line.match(/^\s+\w/))
    const commandNames = commandLines.map((line: string) => line.trim().split(/\s+/)[0])
    expect(commandNames).not.toContain('task')
  })

  it('should show man-page help for subcommand', async () => {
    const captured: string[] = []
    const program = createProgram()
    program.exitOverride()
    program.configureOutput({
      writeOut: (str: string) => captured.push(str),
      writeErr: () => {},
    })

    try {
      await program.parseAsync(['node', 'dagman', 'help', 'next'])
    } catch {
      // outputHelp may throw via exitOverride
    }

    const output = captured.join('')
    expect(output).toContain('Examples:')
    expect(output).toContain('Exit Status:')
  })

  it('should throw CliError for unknown subcommand', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const program = createProgram()
    program.exitOverride()
    program.configureOutput({ writeErr: () => {} })

    await expect(program.parseAsync(['node', 'dagman', 'help', 'nonexistent'])).rejects.toThrow(
      'Unknown command: nonexistent',
    )

    errorSpy.mockRestore()
  })

  it('should show man-page help for ls command', async () => {
    const captured: string[] = []
    const program = createProgram()
    program.exitOverride()
    program.configureOutput({
      writeOut: (str: string) => captured.push(str),
      writeErr: () => {},
    })

    try {
      await program.parseAsync(['node', 'dagman', 'help', 'ls'])
    } catch {
      // outputHelp may throw via exitOverride
    }

    const output = captured.join('')
    expect(output).toContain('Examples:')
    expect(output).toContain('dagman ls')
    expect(output).toContain('See Also:')
  })

  it('should show man-page help for start command', async () => {
    const captured: string[] = []
    const program = createProgram()
    program.exitOverride()
    program.configureOutput({
      writeOut: (str: string) => captured.push(str),
      writeErr: () => {},
    })

    try {
      await program.parseAsync(['node', 'dagman', 'help', 'start'])
    } catch {
      // outputHelp may throw via exitOverride
    }

    const output = captured.join('')
    expect(output).toContain('Compile a workflow')
    expect(output).toContain('Examples:')
    expect(output).toContain('dagman start')
  })
})
