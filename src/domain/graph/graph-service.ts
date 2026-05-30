import type { Node } from '../../shared/models/node.js'
import type { Edge } from '../../shared/models/graph.js'
import type { Task } from '../../shared/models/task.js'

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
