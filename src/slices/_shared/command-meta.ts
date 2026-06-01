import type { Command } from 'commander'
import * as path from 'path'
import { existsSync } from 'fs'

/**
 * Man page style metadata for a CLI command.
 * Stored on Commander Command objects via Symbol key.
 */
export interface CommandMeta {
  /** Usage examples shown in --help after text */
  examples: Array<{ description: string; command: string }>
  /** Exit status codes */
  exitStatus: Array<{ code: number; meaning: string }>
  /** Related command references (man page style: "dagman-node(1)") */
  seeAlso: string[]
  /** Whether this command produces data output (eligible for --json) */
  dataProducing: boolean
}

const META_KEY = Symbol('dagman:command-meta')

// Detect package root by searching upward for package.json
// Dev:    this file is at src/slices/_shared/ (3 levels up)
// Compiled: this file is at dist/src/slices/_shared/ (4 levels up)
function findPkgRoot(): string {
  let dir = __dirname
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, 'package.json'))) return dir
    dir = path.dirname(dir)
  }
  return __dirname
}

const PKG_ROOT = findPkgRoot()

/** Resolve absolute source path for a command slice. */
export function resolveCommandSource(cmdName: string): string {
  return path.resolve(PKG_ROOT, 'src', 'slices', cmdName, 'index.ts')
}

/** Attach metadata to a Commander command object. */
export function setCommandMeta(cmd: Command, meta: CommandMeta): void {
  ;(cmd as unknown as Record<symbol, CommandMeta>)[META_KEY] = meta
}

/** Read metadata from a Commander command object. */
export function getCommandMeta(cmd: Command): CommandMeta | undefined {
  return (cmd as unknown as Record<symbol, CommandMeta>)[META_KEY]
}
