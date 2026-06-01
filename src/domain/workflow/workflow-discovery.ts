import type { Dirent } from 'fs'
import type { WorkflowLoader } from '../../shared/utils/loader.js'

// ===== Dependency Injection =====

export type WorkflowSource = 'local' | 'global'

export interface DiscoveredWorkflow {
  name: string
  version: string
  description: string
  source: WorkflowSource
}

export interface DiscoveryDeps {
  getWorkflowsDirs?: () => string[]
  readdir?: (dir: string, opts?: { withFileTypes?: boolean }) => Promise<Dirent[]>
  loader?: WorkflowLoader
  getWorkflowTsFile?: (name: string) => string
}

let _defaults: Partial<DiscoveryDeps> = {}

/** Set default deps — called by engine/composition root at startup */
export function setDefaultDiscoveryDeps(defaults: Partial<DiscoveryDeps>): void {
  _defaults = { ..._defaults, ...defaults }
}

export function resolveDiscoveryDeps(deps?: DiscoveryDeps) {
  const merged = { ..._defaults, ...deps }
  return {
    getWorkflowsDirs: merged.getWorkflowsDirs!,
    readdir: merged.readdir!,
    loader: merged.loader!,
    getWorkflowTsFile: merged.getWorkflowTsFile!,
  }
}

/**
 * Scan multiple workflow directories and load metadata from index.ts files.
 * Directories are scanned in priority order (global first, local last)
 * so local entries naturally override global on name collision.
 */
export async function listWorkflows(deps?: DiscoveryDeps): Promise<DiscoveredWorkflow[]> {
  const { getWorkflowsDirs, readdir, loader, getWorkflowTsFile } = resolveDiscoveryDeps(deps)
  const seen = new Map<string, DiscoveredWorkflow>()
  const dirs = getWorkflowsDirs()

  // Scan global first (lower priority), then local (overrides on collision)
  for (let i = dirs.length - 1; i >= 0; i--) {
    const absDir = dirs[i]!
    const source: WorkflowSource = i === 0 ? 'local' : 'global'
    try {
      const entries = await readdir(absDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        try {
          const tsFile = getWorkflowTsFile(entry.name)
          const definition = await loader.load(tsFile)
          seen.set(entry.name, {
            name: definition.name,
            version: definition.version ?? '0.0.0',
            description: definition.description ?? '',
            source,
          })
        } catch {
          // Skip workflows without valid definition
        }
      }
    } catch {
      // workflows dir doesn't exist — silent skip
    }
  }

  return [...seen.values()]
}
