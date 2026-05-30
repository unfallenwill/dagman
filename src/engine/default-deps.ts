import { FsWorkflowRepository } from '../infra/fs/fs-workflow-repo.js'
import { FsEventRepository } from '../infra/fs/fs-event-repo.js'
import { FsRunRepository } from '../infra/fs/fs-run-repo.js'
import { getGraphsDir } from '../infra/fs/paths.js'
import { ensureDir, writeJSON, fileExists, listFiles, readJSON } from '../infra/fs/file-ops.js'
import {
  getRunDir,
  getRunMetaFile,
  getRunsDir,
  getDagmanDir,
  getCurrentRunFilePath,
  getWorkflowTsFile,
  getWorkflowManifest,
} from '../infra/fs/paths.js'
import { createDefaultLoader } from '../infra/loader/tsx-loader.js'
import { setDefaultWorkflowDeps } from '../domain/workflow/workflow-engine.js'
import { setDefaultGraphDeps } from '../domain/graph/graph-service.js'
import { setDefaultRunDeps } from '../domain/run/run-service.js'
import { setDefaultRunResolverDeps } from '../domain/run/run-resolver.js'
import { setDefaultSchedulingDeps } from '../domain/scheduling/scheduler.js'
import { setDefaultCompilerDeps } from '../domain/compiler/compiler.js'
import { systemClock } from '../shared/utils/clock.js'

// Workflow deps
setDefaultWorkflowDeps({
  clock: systemClock,
  repo: new FsWorkflowRepository(),
  eventRepo: new FsEventRepository(),
  runRepo: new FsRunRepository(),
})

// Graph deps
setDefaultGraphDeps({
  getGraphsDir,
  ensureDir,
  writeJSON,
  fileExists,
  listFiles,
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
  getWorkflowTsFile,
})

// Compiler deps
setDefaultCompilerDeps({
  loader: createDefaultLoader(),
  getWorkflowTsFile,
  getWorkflowManifest,
})
