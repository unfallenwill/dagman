import type { StateStore } from '../../shared/models/store-repository.js'
import type { State, StateSchema } from '../../shared/models/compiled-graph.js'
import { getStateFile } from './paths.js'
import { readJSON, writeJSON, fileExists } from './file-ops.js'

/**
 * Filesystem-based implementation of StateStore.
 * Manages state.json — the shared mutable state all nodes read/write.
 */
export class FsStateRepository implements StateStore {
  async init(runId: string, schema: StateSchema): Promise<void> {
    const initial: State = { ...schema }
    await writeJSON(getStateFile(runId), initial)
  }

  async read(runId: string): Promise<State> {
    const filePath = getStateFile(runId)
    if (!(await fileExists(filePath))) {
      return {}
    }
    return readJSON<State>(filePath)
  }

  async patch(runId: string, patch: Record<string, unknown>): Promise<void> {
    const current = await this.read(runId)
    const updated = Object.assign({}, current, patch)
    await writeJSON(getStateFile(runId), updated)
  }

  async reset(runId: string): Promise<void> {
    const filePath = getStateFile(runId)
    if (!(await fileExists(filePath))) {
      return
    }
    // Read current state to extract keys, then reset all values to undefined
    // (effectively clears to empty — re-init requires schema)
    await writeJSON(filePath, {})
  }
}
