import { promises as fs } from 'fs'
import type { Dirent } from 'fs'
import { FsWorkflowRepository } from '../infra/fs/fs-workflow-repo.js'
import { FsEventRepository } from '../infra/fs/fs-event-repo.js'
import { FsRunRepository } from '../infra/fs/fs-run-repo.js'
import { ensureDir, writeJSON, fileExists, readJSON, readYAML } from '../infra/fs/file-ops.js'
import {
  getRunDir,
  getRunMetaFile,
  getRunsDir,
  getDagmanDir,
  getCurrentRunFilePath,
  getWorkflowsDirs,
  resolveWorkflowPathSync,
} from '../infra/fs/paths.js'
import { createDefaultLoader } from '../infra/loader/tsx-loader.js'
import { setDefaultWorkflowDeps } from '../domain/workflow/workflow-engine.js'
import { setDefaultRunDeps } from '../domain/run/run-service.js'
import { setDefaultRunResolverDeps } from '../domain/run/run-resolver.js'
import { setDefaultSchedulingDeps } from '../domain/scheduling/scheduler.js'
import { setDefaultCompilerDeps } from '../domain/compiler/compiler.js'
import { setDefaultDiscoveryDeps } from '../domain/workflow/workflow-discovery.js'
import { systemClock } from '../shared/utils/clock.js'

// Workflow deps
setDefaultWorkflowDeps({
  clock: systemClock,
  repo: new FsWorkflowRepository(),
  eventRepo: new FsEventRepository(),
  runRepo: new FsRunRepository(),
})

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
  getRunDir,
  getRunMetaFile,
  getRunsDir,
  ensureDir,
  readJSON,
  writeJSON,
  fileExists,
})

// Scheduling deps
setDefaultSchedulingDeps({
  loader: createDefaultLoader(),
  getWorkflowTsFile: (name: string) => resolveWorkflowPathSync(`${name}/index.ts`),
})

// Compiler deps
setDefaultCompilerDeps({
  loader: createDefaultLoader(),
  getWorkflowTsFile: (name: string) => resolveWorkflowPathSync(`${name}/index.ts`),
  getWorkflowManifest: (name: string) => resolveWorkflowPathSync(`${name}/manifest.yaml`),
})

// Discovery deps (workflow listing and manifest reading)
setDefaultDiscoveryDeps({
  getWorkflowsDirs,
  readdir: (dir: string, opts?: { withFileTypes?: boolean }) =>
    fs.readdir(dir, opts as Parameters<typeof fs.readdir>[1]) as unknown as Promise<Dirent[]>,
  readYAML,
  getWorkflowManifest: (name: string) => resolveWorkflowPathSync(`${name}/manifest.yaml`),
})
