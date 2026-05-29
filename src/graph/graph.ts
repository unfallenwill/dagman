import type { Node } from '../models/node.js'
import type { Edge, Graph } from '../models/graph.js'
import type { Task } from '../models/task.js'
import { getGraphsDir } from '../constants.js'
import { ensureDir, writeJSON, fileExists, listFiles } from '../utils/file.js'
import { GraphNotFoundError } from '../errors.js'
import * as path from 'path'

// ── Graph CRUD ──

export async function loadGraph(name: string): Promise<Graph> {
  // Only load compiled JSON graphs (from TS workflow)
  return loadCompiledGraph(name)
}

export async function listGraphs(): Promise<Graph[]> {
  const graphs: Graph[] = []
  const graphsDir = getGraphsDir()

  // Load compiled JSON graphs only
  const jsonFiles = await listFiles(graphsDir, '.json')
  for (const file of jsonFiles) {
    try {
      const fs = await import('fs/promises')
      const content = await fs.readFile(path.join(graphsDir, file), 'utf-8')
      graphs.push(JSON.parse(content) as Graph)
    } catch {
      // Skip if a single file fails to parse
    }
  }

  return graphs
}

export async function graphExists(name: string): Promise<boolean> {
  return fileExists(path.join(getGraphsDir(), name + '.json'))
}

/** Load a compiled JSON graph (from tsx workflow compilation) */
export async function loadCompiledGraph(name: string): Promise<Graph> {
  const filePath = path.join(getGraphsDir(), name + '.json')
  if (!(await fileExists(filePath))) {
    throw new GraphNotFoundError(name)
  }
  const fs = await import('fs/promises')
  const content = await fs.readFile(filePath, 'utf-8')
  return JSON.parse(content) as Graph
}

/** Save a compiled graph as JSON (from tsx workflow compilation) */
export async function saveCompiledGraph(graph: Graph): Promise<void> {
  const graphsDir = getGraphsDir()
  await ensureDir(graphsDir)
  const filePath = path.join(graphsDir, graph.name + '.json')
  await writeJSON(filePath, graph)
}

// ── Graph Display ──

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return hh + ':' + mm
}

export function formatGraph(
  nodes: Node[],
  edges: Edge[],
  tasks: Task[],
  timestamps?: Record<string, string>,
): string {
  if (nodes.length === 0) {
    return 'no registered nodes'
  }

  const ts = timestamps ?? {}
  const taskMap = new Map(tasks.map((t) => [t.nodeId, t]))
  const sorted = [...nodes].sort((a, b) => a.name.localeCompare(b.name))

  return sorted
    .map((node) => {
      const task = taskMap.get(node.name)
      const status = task?.status ?? 'pending'
      const statusDisplay = ts[node.name] ? status + ' ' + formatTimestamp(ts[node.name]!) : status
      const inEdges = edges
        .filter((e) => e.from === node.name)
        .map((e) => {
          const expect = e.expect ?? 'success'
          return e.to + ':' + expect
        })
        .join(', ')

      if (inEdges) {
        return node.name + ' [' + statusDisplay + '] -> ' + inEdges
      }
      return node.name + ' [' + statusDisplay + ']'
    })
    .join('\n')
}
