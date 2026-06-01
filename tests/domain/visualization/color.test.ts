import { describe, it, expect } from 'vitest'
import { createTheme } from '../../../src/domain/visualization/color.js'

/** Strip ANSI escape codes */
function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*m/g, '')
}

describe('color', () => {
  describe('createTheme', () => {
    it('should return identity functions when disabled', () => {
      const theme = createTheme(false)

      expect(theme.node('hello')).toBe('hello')
      expect(theme.virtual('world')).toBe('world')
      expect(theme.edge('→')).toBe('→')
      expect(theme.condEdge('◇')).toBe('◇')
      expect(theme.dim('dim')).toBe('dim')
    })

    it('should preserve visible text when enabled (regardless of TTY)', () => {
      const theme = createTheme(true)

      const testText = 'node-A'
      // Whether or not ANSI codes are emitted (depends on TTY detection),
      // the visible text is always preserved
      expect(stripAnsi(theme.node(testText))).toBe(testText)
      expect(stripAnsi(theme.virtual(testText))).toBe(testText)
      expect(stripAnsi(theme.edge(testText))).toBe(testText)
      expect(stripAnsi(theme.condEdge(testText))).toBe(testText)
      expect(stripAnsi(theme.dim(testText))).toBe(testText)
    })

    it('should produce output that strips to the original for both modes', () => {
      const off = createTheme(false)
      const on = createTheme(true)

      // Disabled mode always returns exact input
      expect(off.node('X')).toBe('X')
      expect(off.condEdge('Y')).toBe('Y')

      // Enabled mode: visible text is preserved (ANSI may or may not be present)
      expect(stripAnsi(on.node('X'))).toBe('X')
      expect(stripAnsi(on.condEdge('Y'))).toBe('Y')
    })

    it('should have all 5 required theme methods', () => {
      const theme = createTheme(false)
      expect(typeof theme.node).toBe('function')
      expect(typeof theme.virtual).toBe('function')
      expect(typeof theme.edge).toBe('function')
      expect(typeof theme.condEdge).toBe('function')
      expect(typeof theme.dim).toBe('function')
    })
  })
})
