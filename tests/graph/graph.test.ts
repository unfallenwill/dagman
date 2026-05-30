import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { formatGraph } from '../../src/domain/graph/graph-service.js'
import { initTmpDir, cleanupTmpDir } from '../helpers/setup.js'
import type { Node } from '../../src/shared/models/node.js'
import type { Edge } from '../../src/shared/models/graph.js'
import type { Task } from '../../src/shared/models/task.js'

describe('graph', () => {
  beforeEach(() => {
    initTmpDir()
  })

  afterEach(async () => {
    await cleanupTmpDir()
  })

  describe('formatGraph', () => {
    it('returns "no registered nodes" for empty node list', () => {
      const nodes: Node[] = []
      const edges: Edge[] = []
      const tasks: Task[] = []

      const formatted = formatGraph(nodes, edges, tasks)
      expect(formatted).toBe('no registered nodes')
    })

    it('formats a simple graph without tasks', () => {
      const nodes: Node[] = [{ name: 'nodeA' }, { name: 'nodeB' }]
      const edges: Edge[] = [{ from: 'nodeB', to: 'nodeA' }]
      const tasks: Task[] = []

      const formatted = formatGraph(nodes, edges, tasks)
      const lines = formatted.split('\n')

      expect(lines).toHaveLength(2)
      expect(lines[0]!).toContain('nodeA')
      expect(lines[1]!).toContain('nodeB')
    })

    it('formats a graph with tasks showing status', () => {
      const nodes: Node[] = [{ name: 'nodeA' }, { name: 'nodeB' }]
      const edges: Edge[] = [{ from: 'nodeB', to: 'nodeA' }]
      const tasks: Task[] = [
        { nodeId: 'nodeA', status: 'success' } as Task,
        { nodeId: 'nodeB', status: 'running' } as Task,
      ]

      const formatted = formatGraph(nodes, edges, tasks)
      const lines = formatted.split('\n')

      expect(lines[0]!).toContain('nodeA')
      expect(lines[0]!).toContain('success')
      expect(lines[1]!).toContain('nodeB')
      expect(lines[1]!).toContain('running')
    })

    it('formats edges with expect status', () => {
      const nodes: Node[] = [{ name: 'nodeA' }, { name: 'nodeB' }]
      const edges: Edge[] = [{ from: 'nodeB', to: 'nodeA', expect: 'success' }]
      const tasks: Task[] = []

      const formatted = formatGraph(nodes, edges, tasks)
      expect(formatted).toContain('->')
      expect(formatted).toContain('nodeA:success')
    })

    it('formats multiple edges for a node', () => {
      const nodes: Node[] = [{ name: 'nodeA' }, { name: 'nodeB' }, { name: 'nodeC' }]
      const edges: Edge[] = [
        { from: 'nodeA', to: 'nodeB' },
        { from: 'nodeA', to: 'nodeC' },
      ]
      const tasks: Task[] = []

      const formatted = formatGraph(nodes, edges, tasks)
      // nodeA should show both its outgoing edges
      const nodeALine = formatted.split('\n').find((l) => l.includes('nodeA'))
      expect(nodeALine).toBeDefined()
      // Should show both nodeB and nodeC as targets
      expect(nodeALine).toContain('nodeB')
      expect(nodeALine).toContain('nodeC')
    })

    it('formats with timestamps', () => {
      const nodes: Node[] = [{ name: 'nodeA' }]
      const edges: Edge[] = []
      const tasks: Task[] = [{ nodeId: 'nodeA', status: 'success' } as Task]
      // Use UTC timestamp to avoid timezone issues
      const timestamps = {
        nodeA: '2026-05-30T10:30:45.123Z',
      }

      const formatted = formatGraph(nodes, edges, tasks, timestamps)
      // Timestamp should be formatted as HH:MM (in local timezone)
      // Just check that it contains a time-like format
      expect(formatted).toMatch(/nodeA \[success \d{2}:\d{2}\]/)
    })

    it('sorts nodes alphabetically', () => {
      const nodes: Node[] = [{ name: 'nodeZ' }, { name: 'nodeA' }, { name: 'nodeM' }]
      const edges: Edge[] = []
      const tasks: Task[] = []

      const formatted = formatGraph(nodes, edges, tasks)
      const lines = formatted.split('\n')

      expect(lines[0]!).toContain('nodeA')
      expect(lines[1]!).toContain('nodeM')
      expect(lines[2]!).toContain('nodeZ')
    })
  })
})
