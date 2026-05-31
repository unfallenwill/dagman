import type { ChannelStore } from '../../shared/models/store-repository.js'
import type { Channel } from '../../shared/models/compiled-graph.js'
import { getChannelsFile } from './paths.js'
import { readJSON, writeJSON, fileExists } from './file-ops.js'

/** Internal shape stored in channels.json */
type ChannelMap = Record<string, Channel>

/**
 * Filesystem-based implementation of ChannelStore.
 * Manages channels.json — trigger and barrier channel states.
 */
export class FsChannelRepository implements ChannelStore {
  async init(
    runId: string,
    channels: Record<string, { type: 'trigger' | 'barrier'; writers?: string[] }>,
  ): Promise<void> {
    const map: ChannelMap = {}
    for (const [name, def] of Object.entries(channels)) {
      if (def.type === 'trigger') {
        map[name] = { name, type: 'trigger', version: 0 }
      } else {
        map[name] = {
          name,
          type: 'barrier',
          writers: def.writers ?? [],
          received: [],
          version: 0,
        }
      }
    }
    await writeJSON(getChannelsFile(runId), map)
  }

  async readAll(runId: string): Promise<Record<string, Channel>> {
    const filePath = getChannelsFile(runId)
    if (!(await fileExists(filePath))) {
      return {}
    }
    return readJSON<ChannelMap>(filePath)
  }

  async read(runId: string, name: string): Promise<Channel | null> {
    const all = await this.readAll(runId)
    return all[name] ?? null
  }

  async trigger(runId: string, name: string): Promise<void> {
    const all = await this.readAll(runId)
    const ch = all[name]
    if (!ch?.type || ch.type !== 'trigger') {
      throw new Error(`trigger channel '${name}' not found`)
    }
    ch.version += 1
    await writeJSON(getChannelsFile(runId), all)
  }

  async barrierWrite(runId: string, name: string, writerId: string): Promise<boolean> {
    const all = await this.readAll(runId)
    const ch = all[name]
    if (!ch?.type || ch.type !== 'barrier') {
      throw new Error(`barrier channel '${name}' not found`)
    }
    if (!ch.received.includes(writerId)) {
      ch.received.push(writerId)
    }
    const complete = ch.received.length === ch.writers.length
    if (complete && ch.version === 0) {
      ch.version = 1
    }
    await writeJSON(getChannelsFile(runId), all)
    return complete
  }

  async getVersion(runId: string, name: string): Promise<number> {
    const ch = await this.read(runId, name)
    if (!ch) {
      throw new Error(`channel '${name}' not found`)
    }
    return ch.version
  }
}
