import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { createProgram, run } from '../../src/engine/cli.js'

const TMP_DIR = path.join(os.tmpdir(), `dagman-cli-test-${Date.now()}`)

let originalCwd: string

beforeEach(async () => {
  originalCwd = process.cwd()
  await fs.mkdir(TMP_DIR, { recursive: true })
  process.chdir(TMP_DIR)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.rm(TMP_DIR, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// createProgram — program structure tests
// ---------------------------------------------------------------------------
describe('createProgram', () => {
  it('should register all expected subcommands', () => {
    const program = createProgram()
    const commandNames = program.commands.map((cmd) => cmd.name())

    const expected = [
      'help',
      'ls',
      'graph',
      'start',
      'ps',
      'show',
      'compile',
      'next',
      'collect',
      'log',
    ]
    for (const name of expected) {
      expect(commandNames, `missing subcommand "${name}"`).toContain(name)
    }
  })

  it('should set program name to "dagman"', () => {
    const program = createProgram()
    expect(program.name()).toBe('dagman')
  })

  it('should configure version from package.json', () => {
    const program = createProgram()
    // version is set by registerHelpCommand
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('should set a top-level description', () => {
    const program = createProgram()
    expect(program.description()).toBeTruthy()
  })

  it('should configure help sorting', () => {
    const program = createProgram()
    const helpConfig = program.configureHelp()
    expect(helpConfig.sortSubcommands).toBe(true)
    expect(helpConfig.sortOptions).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// run — positive tests
// ---------------------------------------------------------------------------
describe('run (positive)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('should output help text with --help flag', () => {
    // --help causes Commander to output help and call process.exit(0).
    // We use createProgram with exitOverride to catch it.
    const captured: string[] = []
    const program = createProgram()
    program.exitOverride()
    program.configureOutput({
      writeOut: (str: string) => captured.push(str),
      writeErr: () => {},
    })

    try {
      program.parse(['node', 'dagman', '--help'])
    } catch (err) {
      // Commander throws CommanderError with exitCode 0 for --help
      expect((err as { exitCode?: number }).exitCode).toBe(0)
    }

    const output = captured.join('')
    expect(output).toContain('dagman')
    expect(output).toContain('Usage')
  })

  it('should output version with --version flag', () => {
    const captured: string[] = []
    const program = createProgram()
    program.exitOverride()
    program.configureOutput({
      writeOut: (str: string) => captured.push(str),
      writeErr: () => {},
    })

    try {
      program.parse(['node', 'dagman', '--version'])
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(0)
    }

    const output = captured.join('')
    expect(output).toMatch(/\d+\.\d+\.\d+/)
  })

  it('should run "ls" command without error', async () => {
    // ls outputs "No workflows found" when there are none
    const program = createProgram()
    program.exitOverride()
    program.configureOutput({ writeErr: () => {} })

    await program.parseAsync(['node', 'dagman', 'ls'])

    expect(logSpy).toHaveBeenCalledWith('No workflows found in .dagman/workflows/')
  })

  it('should run "ps" command without error', async () => {
    const program = createProgram()
    program.exitOverride()
    program.configureOutput({ writeErr: () => {} })

    await program.parseAsync(['node', 'dagman', 'ps'])

    expect(logSpy).toHaveBeenCalledWith('No workflow instances found.')
  })

  it('should run "help" command and output overview', async () => {
    const captured: string[] = []
    const program = createProgram()
    program.exitOverride()
    program.configureOutput({
      writeOut: (str: string) => captured.push(str),
      writeErr: () => {},
    })

    await program.parseAsync(['node', 'dagman', 'help'])

    const calls = logSpy.mock.calls.map((args: unknown[]) => args.join(' '))
    const fullOutput = calls.join('\n')
    expect(fullOutput).toContain('Overview')
    expect(fullOutput).toContain('dagman')
  })
})

// ---------------------------------------------------------------------------
// run — negative tests
// ---------------------------------------------------------------------------
describe('run (negative)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('should error on unknown command', () => {
    const captured: string[] = []
    const program = createProgram()
    program.exitOverride()
    program.configureOutput({
      writeOut: () => {},
      writeErr: (str: string) => captured.push(str),
    })

    expect(() => {
      program.parse(['node', 'dagman', 'foobar'])
    }).toThrow()

    const errorOutput = captured.join('')
    expect(errorOutput).toContain("error: unknown command 'foobar'")
  })

  it('should output help when called with no arguments', () => {
    const captured: string[] = []
    const program = createProgram()
    program.exitOverride()
    program.configureOutput({
      writeOut: (str: string) => captured.push(str),
      writeErr: (str: string) => captured.push(str),
    })

    // With no subcommand, Commander outputs help (or error depending on config)
    try {
      program.parse(['node', 'dagman'])
    } catch (err) {
      // Either way it should not succeed silently
      const output = captured.join('')
      // Should contain usage/help information
      expect(output.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// run() function integration — tests the exported run() directly
// ---------------------------------------------------------------------------
describe('run function', () => {
  it('should not throw when given a valid command argv', () => {
    // run() uses synchronous parse(), so async action handlers fire-and-forget.
    // We just verify the function does not throw for valid input.
    expect(() => run(['node', 'dagman', 'ls'])).not.toThrow()
  })

  it('should not throw when given ps command argv', () => {
    expect(() => run(['node', 'dagman', 'ps'])).not.toThrow()
  })

  it('should accept argv parameter matching process.argv format', () => {
    // Verify run() accepts the 3-element argv format [node, script, ...args]
    expect(() => run(['node', 'dagman', 'help'])).not.toThrow()
  })
})
