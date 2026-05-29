import type { Event } from '../models/event.js'
import { getEventsFile } from '../constants.js'
import { resolveCurrentRunId } from '../utils/run-resolver.js'
import { promises as fs } from 'fs'
import * as path from 'path'

async function resolveRun(runId?: string): Promise<string> {
  if (runId) return runId
  return resolveCurrentRunId()
}

export async function appendEvent(
  node: string,
  from: string,
  to: string,
  runId?: string,
): Promise<void> {
  const rid = await resolveRun(runId)
  const event: Event = {
    timestamp: new Date().toISOString(),
    node,
    from,
    to,
  }
  const filePath = getEventsFile(rid)
  const abs = path.resolve(path.dirname(filePath))
  await fs.mkdir(abs, { recursive: true })
  const line = JSON.stringify(event) + '\n'
  await fs.appendFile(path.resolve(filePath), line, 'utf-8')
}

export async function readEvents(runId?: string): Promise<Event[]> {
  const rid = await resolveRun(runId)
  const filePath = getEventsFile(rid)
  try {
    const content = await fs.readFile(path.resolve(filePath), 'utf-8')
    return content
      .trim()
      .split('\n')
      .filter((line: string) => line.length > 0)
      .map((line: string) => JSON.parse(line) as Event)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw err
  }
}

export async function getLatestNodeTimestamp(
  nodeName: string,
  runId?: string,
): Promise<string | null> {
  const events = await readEvents(runId)
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i]!
    if (evt.node === nodeName) {
      return evt.timestamp
    }
  }
  return null
}

export async function getNodeTimestamps(runId?: string): Promise<Record<string, string>> {
  const events = await readEvents(runId)
  const map: Record<string, string> = {}
  for (const e of events) {
    map[e.node] = e.timestamp
  }
  return map
}
