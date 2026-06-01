/**
 * Dagman configuration types.
 * Config is read from ~/.dagman/config.json (user-level).
 */

/** Storage backend type discriminator */
export type StorageBackendType = 'json' | 'sqlite'

/** JSON backend configuration */
export interface JsonBackendConfig {
  readonly type: 'json'
}

/** SQLite backend configuration (future) */
export interface SqliteBackendConfig {
  readonly type: 'sqlite'
  /** Path to the SQLite database file. Defaults to ~/.dagman/dagman.db */
  readonly dbPath?: string
}

/** Union of backend configs */
export type BackendConfig = JsonBackendConfig | SqliteBackendConfig

/** Root dagman configuration */
export interface DagmanConfig {
  /** Storage backend selection. Defaults to { type: 'json' } */
  readonly storage?: BackendConfig
}

/** Full config with defaults applied */
export interface ResolvedDagmanConfig {
  readonly storage: BackendConfig
}

/** The default config when no config file exists */
export const DEFAULT_CONFIG: ResolvedDagmanConfig = {
  storage: { type: 'json' },
}
