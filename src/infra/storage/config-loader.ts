/**
 * Configuration loader for dagman.
 *
 * Reads ~/.dagman/config.json, merges with defaults, returns ResolvedDagmanConfig.
 * Uses sync I/O (acceptable for CLI startup).
 */

import { existsSync, readFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { DagmanConfig, ResolvedDagmanConfig } from '../../shared/models/config.js'
import { DEFAULT_CONFIG } from '../../shared/models/config.js'

const CONFIG_DIR = path.join(os.homedir(), '.dagman')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

/** Get the config file path */
export function getConfigPath(): string {
  return CONFIG_FILE
}

/** Get the config directory path */
export function getConfigDir(): string {
  return CONFIG_DIR
}

let _cached: ResolvedDagmanConfig | null = null

/**
 * Load and resolve dagman configuration.
 *
 * Reads ~/.dagman/config.json (sync). If missing or malformed,
 * returns DEFAULT_CONFIG silently.
 */
export function loadConfig(): ResolvedDagmanConfig {
  if (_cached) return _cached

  if (!existsSync(CONFIG_FILE)) {
    _cached = { ...DEFAULT_CONFIG }
    return _cached
  }

  try {
    const raw = readFileSync(CONFIG_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as DagmanConfig
    _cached = {
      storage: parsed.storage ?? DEFAULT_CONFIG.storage,
    }
    return _cached
  } catch (err) {
    console.warn(
      `Warning: failed to parse ${CONFIG_FILE}, using defaults. ${err instanceof Error ? err.message : String(err)}`,
    )
    _cached = { ...DEFAULT_CONFIG }
    return _cached
  }
}

/** Reset cached config (for testing) */
export function resetConfig(): void {
  _cached = null
}
