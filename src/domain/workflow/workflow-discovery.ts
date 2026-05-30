import type { Dirent } from 'fs'
import type { WorkflowManifest } from '../../shared/models/workflow-def.js'

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
  readYAML?: <T>(filePath: string) => Promise<T>
  getWorkflowManifest?: (name: string) => string
}

let _defaults: Partial<DiscoveryDeps> = {}

/** Set default deps — called by engine/composition root at startup */
export function setDefaultDiscoveryDeps(defaults: Partial<DiscoveryDeps>): void {
  _defaults = { ..._defaults, ...defaults }
}

function resolveDiscoveryDeps(deps?: DiscoveryDeps) {
  const merged = { ..._defaults, ...deps }
  return {
    getWorkflowsDirs: merged.getWorkflowsDirs!,
    readdir: merged.readdir!,
    readYAML: merged.readYAML!,
    getWorkflowManifest: merged.getWorkflowManifest!,
  }
}

/**
 * Scan multiple workflow directories for manifest.yaml files.
 * Directories are scanned in priority order (global first, local last)
 * so local entries naturally override global on name collision.
 */
export async function listWorkflows(deps?: DiscoveryDeps): Promise<DiscoveredWorkflow[]> {
  const { getWorkflowsDirs, readdir, readYAML } = resolveDiscoveryDeps(deps)
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
        const manifestPath = absDir + '/' + entry.name + '/manifest.yaml'
        try {
          const data = await readYAML<Record<string, unknown>>(manifestPath)
          seen.set(entry.name, {
            name: (data.name as string) || entry.name,
            version: (data.version as string) || '0.0.0',
            description: (data.description as string) || '',
            source,
          })
        } catch {
          // Skip workflows without valid manifest
        }
      }
    } catch {
      // workflows dir doesn't exist — silent skip
    }
  }

  return [...seen.values()]
}

/**
 * Load and return manifest for a specific workflow.
 */
export async function loadManifest(name: string, deps?: DiscoveryDeps): Promise<WorkflowManifest> {
  const { getWorkflowManifest, readYAML } = resolveDiscoveryDeps(deps)
  const manifestFile = getWorkflowManifest(name)
  const data = await readYAML<Record<string, unknown>>(manifestFile)
  return {
    name: (data.name as string) || name,
    version: (data.version as string) || '0.0.0',
    description: (data.description as string) || '',
    author: data.author as string | undefined,
    repository: data.repository as string | undefined,
    license: data.license as string | undefined,
  }
}
