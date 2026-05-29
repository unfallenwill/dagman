import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withErrorHandler, outputJson } from '../../../src/slices/_shared/output.js'
import { ValidationError } from '../../../src/shared/errors.js'

describe('withErrorHandler', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('should call the wrapped function with provided args', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const wrapped = withErrorHandler(fn)
    await wrapped('arg1', 'arg2')
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2')
  })

  it('should not exit when function succeeds', async () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const wrapped = withErrorHandler(fn)
    await wrapped()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('should catch generic Error and print message to stderr', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('something broke'))
    const wrapped = withErrorHandler(fn)
    await wrapped()
    expect(errorSpy).toHaveBeenCalledWith('Error: something broke')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('should catch ValidationError and print message plus error list', async () => {
    const err = new ValidationError('validation failed', ['field A is wrong', 'field B missing'])
    const fn = vi.fn().mockRejectedValue(err)
    const wrapped = withErrorHandler(fn)
    await wrapped()
    expect(errorSpy).toHaveBeenCalledWith('Error: validation failed')
    expect(errorSpy).toHaveBeenCalledWith('  - field A is wrong')
    expect(errorSpy).toHaveBeenCalledWith('  - field B missing')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('should catch ValidationError with empty error list', async () => {
    const err = new ValidationError('bad data')
    const fn = vi.fn().mockRejectedValue(err)
    const wrapped = withErrorHandler(fn)
    await wrapped()
    expect(errorSpy).toHaveBeenCalledWith('Error: bad data')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('should catch non-Error throws', async () => {
    const fn = vi.fn().mockRejectedValue('string error')
    const wrapped = withErrorHandler(fn)
    await wrapped()
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

describe('outputJson', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('should output formatted JSON to stdout', () => {
    outputJson({ key: 'value' })
    expect(logSpy).toHaveBeenCalledWith('{\n  "key": "value"\n}')
  })

  it('should output arrays', () => {
    outputJson([1, 2, 3])
    expect(logSpy).toHaveBeenCalledWith('[\n  1,\n  2,\n  3\n]')
  })

  it('should output primitives', () => {
    outputJson('hello')
    expect(logSpy).toHaveBeenCalledWith('"hello"')
  })

  it('should output null', () => {
    outputJson(null)
    expect(logSpy).toHaveBeenCalledWith('null')
  })
})
