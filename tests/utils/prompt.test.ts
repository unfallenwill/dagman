import { describe, it, expect } from 'vitest'
import { confirmPrompt } from '../../src/utils/prompt.js'

describe('confirmPrompt', () => {
  it('should return false when stdin is not a TTY', async () => {
    const originalIsTTY = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    const result = await confirmPrompt('Continue?')
    expect(result).toBe(false)
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
  })
})
