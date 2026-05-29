import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { mkdtempSync } from 'fs'
import { setBasePath } from '../../src/constants.js'
import * as runService from '../../src/runtime/run.js'
import type { Edge } from '../../src/shared/models/graph.js'

let tmpDir: string

/**
 * Create a unique temporary directory, set it as dagman's basePath, and chdir into it.
 * Call this in beforeEach(). Call cleanupTmpDir() in afterEach().
 */
export function initTmpDir(): string {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'dagman-test-'))
  setBasePath(tmpDir)
  process.chdir(tmpDir)
  return tmpDir
}

/**
 * Reset basePath and remove the temporary directory.
 * Call this in afterEach().
 */
export async function cleanupTmpDir(): Promise<void> {
  setBasePath('')
  process.chdir(path.resolve('..'))
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

/** Get the current test's temporary directory path. */
export function getTmpDir(): string {
  return tmpDir
}

/** Create a compiled graph JSON file and a run instance. Returns the run ID. */
export async function setupCompiledRun(
  nodeNames: string[],
  edges: Edge[],
  graphName = 'test-graph',
): Promise<string> {
  await fs.mkdir(path.join(tmpDir, '.dagman/graphs'), { recursive: true })
  const graphData = {
    name: graphName,
    edges,
    nodes: nodeNames.map((name) => ({
      name,
      description: `Test node ${name}`,
      instructions: `Do work for ${name}`,
      kind: 'user',
    })),
  }
  await fs.writeFile(
    path.join(tmpDir, `.dagman/graphs/${graphName}.json`),
    JSON.stringify(graphData, null, 2),
  )
  const info = await runService.createRun(undefined, graphName, true)
  return info.id
}
