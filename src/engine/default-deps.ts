import { promises as fs } from 'fs'
import type { Dirent } from 'fs'
import * as path from 'path'
import { FsRunRepository } from '../infra/fs/fs-run-repo.js'
import { FsStateRepository } from '../infra/fs/fs-state-repo.js'
import { FsChannelRepository } from '../infra/fs/fs-channel-repo.js'
import { FsTaskRepository } from '../infra/fs/fs-task-repo.js'
import { FsRunStoreAdapter } from '../infra/fs/fs-run-store-adapter.js'
import { writeJSON } from '../infra/fs/file-ops.js'
import {
  getRunMetaFile,
  getCurrentRunFilePath,
  getRunsDir,
  getDagmanDir,
  getGraphFile,
  getWorkflowsDirs,
  resolveWorkflowPathSync,
} from '../infra/fs/paths.js'
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
import { ensureDir, fileExists, readJSON } from '../infra/fs/file-ops.js'

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

// ── New Architecture DI ──────────────────────────────────────────

const stateStore = new FsStateRepository()
const channelStore = new FsChannelRepository()
const taskStore = new FsTaskRepository()
const runRepo = new FsRunRepository()
const runStore = new FsRunStoreAdapter(runRepo)

// Wire execution engine deps
setDefaultEngineDeps({
  stateStore,
  channelStore,
  taskStore,
  runStore,
  clock: systemClock,
  writeJSON,
  getGraphFile,
  compileWorkflow: compile,
})

// Wire state service deps
setDefaultStateServiceDeps({
  stateStore,
})

// Wire channel service deps
setDefaultChannelServiceDeps({
  channelStore,
})

// ── Dynamic overrides ──────────────────────────────────────────

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
