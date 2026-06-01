/**
 * Color theme abstraction for terminal output.
 *
 * Wraps picocolors behind a ColorTheme interface so the renderer
 * stays decoupled from a specific color library. When disabled,
 * all functions return strings unchanged (zero ANSI overhead).
 */

import pc from 'picocolors'

export interface ColorTheme {
  /** Real node name (e.g. cyan bold) */
  node: (text: string) => string
  /** Virtual node label — START / END (e.g. gray) */
  virtual: (text: string) => string
  /** Normal edge characters */
  edge: (text: string) => string
  /** Conditional edge characters (e.g. yellow) */
  condEdge: (text: string) => string
  /** Dim / secondary text */
  dim: (text: string) => string
}

function identity(s: string): string {
  return s
}

/**
 * Create a color theme. When `enabled` is false, all methods are pass-through.
 */
export function createTheme(enabled: boolean): ColorTheme {
  if (!enabled) {
    return {
      node: identity,
      virtual: identity,
      edge: identity,
      condEdge: identity,
      dim: identity,
    }
  }
  return {
    node: (s) => pc.bold(pc.cyan(s)),
    virtual: (s) => pc.gray(s),
    edge: (s) => pc.dim(s),
    condEdge: (s) => pc.yellow(s),
    dim: (s) => pc.dim(s),
  }
}
