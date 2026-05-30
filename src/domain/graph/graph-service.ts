import type { Node } from '../../shared/models/node.js'
import type { Edge, Graph } from '../../shared/models/graph.js'
import type { Task } from '../../shared/models/task.js'
import { GraphNotFoundError } from '../../shared/errors.js'
import * as path from 'path'

// ===== Dependency Injection =====

export interface GraphDeps {
  getGraphsDir?: () => string
  ensureDir?: (dirPath: string) => Promise<void>
  writeJSON?: <T>(filePath: string, data: T) => Promise<void>
  fileExists?: (filePath: string) => Promise<boolean>
  listFiles?: (dirPath: string, ext?: string) => Promise<string[]>
  readFile?: (filePath: string) => Promise<string>
}

let _defaults: Partial<GraphDeps> = {}

/** Set default deps — called by engine/composition root at startup */
export function setDefaultGraphDeps(defaults: Partial<GraphDeps>): void {
  _defaults = { ..._defaults, ...defaults }
}

function resolveGraphDeps(deps?: GraphDeps) {
  const merged = { ..._defaults, ...deps }
  return {
    getGraphsDir: merged.getGraphsDir!,
    ensureDir: merged.ensureDir!,
    writeJSON: merged.writeJSON!,
    fileExists: merged.fileExists!,
    listFiles: merged.listFiles!,
    readFile:
      merged.readFile ??
      (async (filePath: string) => {
        const fs = await import('fs/promises')
        return fs.readFile(filePath, 'utf-8')
      }),
  }
}

// ── Graph CRUD ──

export async function loadGraph(name: string, deps?: GraphDeps): Promise<Graph> {
  // Only load compiled JSON graphs (from TS workflow)
  return loadCompiledGraph(name, deps)
}

export async function listGraphs(deps?: GraphDeps): Promise<Graph[]> {
  const d = resolveGraphDeps(deps)
  const graphs: Graph[] = []
  const graphsDir = d.getGraphsDir()

  // Load compiled JSON graphs only
  const jsonFiles = await d.listFiles(graphsDir, '.json')
  for (const file of jsonFiles) {
    try {
      const content = await d.readFile(path.join(graphsDir, file))
      graphs.push(JSON.parse(content) as Graph)
    } catch {
      // Skip if a single file fails to parse
    }
  }

  return graphs
}

export async function graphExists(name: string, deps?: GraphDeps): Promise<boolean> {
  const d = resolveGraphDeps(deps)
  return d.fileExists(path.join(d.getGraphsDir(), name + '.json'))
}

/** Load a compiled JSON graph (from tsx workflow compilation) */
export async function loadCompiledGraph(name: string, deps?: GraphDeps): Promise<Graph> {
  const d = resolveGraphDeps(deps)
  const filePath = path.join(d.getGraphsDir(), name + '.json')
  if (!(await d.fileExists(filePath))) {
    throw new GraphNotFoundError(name)
  }
  const content = await d.readFile(filePath)
  return JSON.parse(content) as Graph
}

/** Save a compiled graph as JSON (from tsx workflow compilation) */
export async function saveCompiledGraph(graph: Graph, deps?: GraphDeps): Promise<void> {
  const d = resolveGraphDeps(deps)
  const graphsDir = d.getGraphsDir()
  await d.ensureDir(graphsDir)
  const filePath = path.join(graphsDir, graph.name + '.json')
  await d.writeJSON(filePath, graph)
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
