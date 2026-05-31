import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { mkdtempSync } from 'fs'
import { setBasePath } from '../../src/infra/fs/paths.js'

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
