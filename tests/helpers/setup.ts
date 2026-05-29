import { beforeEach, afterEach } from 'vitest'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { mkdtempSync } from 'fs'
import * as runService from '../../src/runtime/run.js'
import type { Edge } from '../../src/models/graph.js'

let originalCwd: string
let tmpDir: string

/**
 * Create a unique temporary directory and chdir into it before each test.
 * Automatically cleans up after each test.
 *
 * Usage in test files:
 *   Just import this file — the hooks are registered globally.
 *   Access `tmpDir` via `useTmpdir()` to get the current test's temp path.
 */
beforeEach(async () => {
  originalCwd = process.cwd()
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'dagman-test-'))
  process.chdir(tmpDir)
})

afterEach(async () => {
  process.chdir(originalCwd)
  await fs.rm(tmpDir, { recursive: true, force: true })
})

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
