import type { Command } from "commander";

/**
 * Man page style metadata for a CLI command.
 * Stored on Commander Command objects via Symbol key.
 */
export interface CommandMeta {
  /** Usage examples shown in --help after text */
  examples: Array<{ description: string; command: string }>;
  /** Exit status codes */
  exitStatus: Array<{ code: number; meaning: string }>;
  /** Related command references (man page style: "dagman-node(1)") */
  seeAlso: string[];
  /** Whether this command produces data output (eligible for --json) */
  dataProducing: boolean;
}

const META_KEY = Symbol("dagman:command-meta");

/** Attach metadata to a Commander command object. */
export function setCommandMeta(cmd: Command, meta: CommandMeta): void {
  (cmd as unknown as Record<symbol, CommandMeta>)[META_KEY] = meta;
}

/** Read metadata from a Commander command object. */
export function getCommandMeta(cmd: Command): CommandMeta | undefined {
  return (cmd as unknown as Record<symbol, CommandMeta>)[META_KEY];
}
