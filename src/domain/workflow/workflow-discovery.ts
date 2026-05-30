import type { Dirent } from 'fs'
import type { WorkflowManifest } from '../../shared/models/workflow-def.js'

// ===== Dependency Injection =====

export interface DiscoveredWorkflow {
  name: string
  version: string
  description: string
}

export interface DiscoveryDeps {
  getWorkflowsDir?: () => string
  readdir?: (dir: string, opts?: { withFileTypes?: boolean }) => Promise<Dirent[]>
  readYAML?: <T>(filePath: string) => Promise<T>
  getWorkflowManifest?: (name: string) => string
}

let _defaults: Partial<DiscoveryDeps> = {}

/** Set default deps — called by engine/composition root at startup */
export function setDefaultDiscoveryDeps(defaults: Partial<DiscoveryDeps>): void {
  _defaults = { ..._defaults, ...defaults }
}

function resolveDiscoveryDeps(deps?: DiscoveryDeps): Required<DiscoveryDeps> {
  const merged = { ..._defaults, ...deps }
  return {
    getWorkflowsDir: merged.getWorkflowsDir!,
    readdir: merged.readdir!,
    readYAML: merged.readYAML!,
    getWorkflowManifest: merged.getWorkflowManifest!,
  }
}

/**
 * Scan .dagman/workflows/ subdirectories for manifest.yaml files.
 */
export async function listWorkflows(deps?: DiscoveryDeps): Promise<DiscoveredWorkflow[]> {
  const { getWorkflowsDir, readdir, readYAML } = resolveDiscoveryDeps(deps)
  const workflows: DiscoveredWorkflow[] = []
  const absDir = getWorkflowsDir()

  try {
    const entries = await readdir(absDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifestPath = absDir + '/' + entry.name + '/manifest.yaml'
      try {
        const data = await readYAML<Record<string, unknown>>(manifestPath)
        workflows.push({
          name: (data.name as string) || entry.name,
          version: (data.version as string) || '0.0.0',
          description: (data.description as string) || '',
        })
      } catch {
        // Skip workflows without valid manifest
      }
    }
  } catch {
    // workflows dir doesn't exist
  }

  return workflows
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
