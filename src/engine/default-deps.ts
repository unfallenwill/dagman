import { promises as fs } from 'fs'
import type { Dirent } from 'fs'
import * as path from 'path'
import { writeJSON } from '../infra/fs/file-ops.js'
import {
  getRunMetaFile,
  getCurrentRunFilePath,
  getRunsDir,
  getDagmanDir,
  getGraphFile,
  getWorkflowsDirs,
  resolveWorkflowPathSync,
  getStateFile,
  getChannelsFile,
  getTasksFile,
} from '../infra/fs/paths.js'
import { ensureDir, fileExists, readJSON } from '../infra/fs/file-ops.js'
import { createDefaultLoader } from '../infra/loader/tsx-loader.js'
import { setDefaultRunDeps } from '../domain/run/run-service.js'
import { setDefaultRunResolverDeps } from '../domain/run/run-resolver.js'
import { setDefaultCompilerDeps } from '../domain/compiler/compiler.js'
import { setDefaultDiscoveryDeps } from '../domain/workflow/workflow-discovery.js'
import { setDefaultEngineDeps } from '../domain/engine/execution-engine.js'
import { setDefaultStateServiceDeps } from '../domain/engine/state-service.js'
import { setDefaultChannelServiceDeps } from '../domain/engine/channel-service.js'
import { compile } from '../domain/compiler/compiler.js'
import { systemClock } from '../shared/utils/clock.js'
import { loadConfig } from '../infra/storage/config-loader.js'
import { createStorageBackend } from '../infra/storage/backend-factory.js'
import { setStorageBackend } from '../infra/storage/backend-instance.js'

const tsxLoader = createDefaultLoader()
const getWorkflowTsFile = (name: string) => resolveWorkflowPathSync(`${name}/index.ts`)

// Shared readdir wrapper for discovery deps
const readdirDirents = (dir: string, opts?: { withFileTypes?: boolean }) =>
  fs.readdir(dir, opts as Parameters<typeof fs.readdir>[1]) as unknown as Promise<Dirent[]>

// Run resolver deps
setDefaultRunResolverDeps({
  getRunMetaFile,
  getCurrentRunFilePath,
  getRunsDir,
  getDagmanDir,
  ensureDir,
  fileExists,
  readJSON,
})

// Run deps
setDefaultRunDeps({
  getRunMetaFile,
  getRunsDir,
  ensureDir,
  readJSON,
  writeJSON,
  fileExists,
})

// Compiler deps
wireWorkflowDeps({ getWorkflowTsFile, getWorkflowsDirs })

// ── Storage Backend (Unified) ────────────────────────────────────────

const config = loadConfig()
const backend = createStorageBackend(config.storage, {
  getStateFile,
  getChannelsFile,
  getTasksFile,
  getRunMetaFile,
  getGraphFile,
  getRunsDir,
  getDagmanDir,
  getCurrentRunFilePath,
  ensureDir,
  readJSON,
  writeJSON,
  fileExists,
  clock: systemClock,
})

// Register backend singleton for slice access
setStorageBackend(backend)

// Wire execution engine deps
setDefaultEngineDeps({
  storageBackend: backend,
  clock: systemClock,
  compileWorkflow: compile,
})

// Wire state service deps
setDefaultStateServiceDeps({
  storageBackend: backend,
})

// Wire channel service deps
setDefaultChannelServiceDeps({
  storageBackend: backend,
})

// ── Dynamic overrides ──────────────────────────────────────────────

/**
 * Wire compiler and discovery DI defaults with the given path functions.
 * Centralizes the shared structure to avoid duplication between initialization and overrides.
 */
function wireWorkflowDeps(deps: {
  getWorkflowTsFile: (name: string) => string
  getWorkflowsDirs: () => string[]
}): void {
  setDefaultCompilerDeps({
    loader: tsxLoader,
    getWorkflowTsFile: deps.getWorkflowTsFile,
  })
  setDefaultDiscoveryDeps({
    getWorkflowsDirs: deps.getWorkflowsDirs,
    readdir: readdirDirents,
    loader: tsxLoader,
    getWorkflowTsFile: deps.getWorkflowTsFile,
  })
}

/**
 * Override workflow search locations for --workflows-dir.
 * Re-wires compiler and discovery DI defaults to use a single custom directory.
 * Call this before command actions run (e.g., in Commander preAction hook).
 */
export function applyWorkflowsDir(dir?: string): void {
  if (!dir) return

  const resolvedDir = path.resolve(dir)

  const customGetWorkflowTsFile = (name: string) => {
    if (name.includes('..')) {
      throw new Error(`invalid workflow path: ${name}`)
    }
    return path.resolve(resolvedDir, name, 'index.ts')
  }
  const customGetWorkflowsDirs = () => [resolvedDir]

  wireWorkflowDeps({
    getWorkflowTsFile: customGetWorkflowTsFile,
    getWorkflowsDirs: customGetWorkflowsDirs,
  })
}

/**
 * Reset workflows dir override, restoring original DI defaults.
 * Useful for test cleanup after calling applyWorkflowsDir().
 */
export function resetWorkflowsDir(): void {
  wireWorkflowDeps({ getWorkflowTsFile, getWorkflowsDirs })
}
