import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs/promises'
import {
  loadCompiledGraph,
  saveCompiledGraph,
  listGraphs,
  formatGraph,
} from '../../src/domain/graph/graph-service.js'
import { GraphNotFoundError } from '../../src/shared/errors.js'
import { initTmpDir, cleanupTmpDir } from '../helpers/setup.js'
import type { Graph } from '../../src/shared/models/graph.js'
import type { Node } from '../../src/shared/models/node.js'
import type { Edge } from '../../src/shared/models/graph.js'
import type { Task } from '../../src/shared/models/task.js'

async function createGraphFile(name: string, nodes?: Node[], edges?: Edge[]): Promise<void> {
  await fs.mkdir('.dagman/graphs', { recursive: true })
  const graph: Graph = {
    name,
    nodes: nodes ?? [],
    edges: edges ?? [],
  }
  await fs.writeFile(`.dagman/graphs/${name}.json`, JSON.stringify(graph), 'utf-8')
}

describe('graph', () => {
  beforeEach(async () => {
    initTmpDir()
  })

  afterEach(async () => {
    await cleanupTmpDir()
  })

  describe('saveCompiledGraph and loadCompiledGraph', () => {
    it('roundtrip: save and load a graph', async () => {
      const originalGraph: Graph = {
        name: 'test-graph',
        nodes: [{ name: 'nodeA' }, { name: 'nodeB' }],
        edges: [{ from: 'nodeB', to: 'nodeA' }],
      }

      await saveCompiledGraph(originalGraph)
      const loadedGraph = await loadCompiledGraph('test-graph')

      expect(loadedGraph.name).toBe(originalGraph.name)
      expect(loadedGraph.nodes).toHaveLength(2)
      expect(loadedGraph.edges).toHaveLength(1)
      expect(loadedGraph.nodes![0]?.name).toBe('nodeA')
      expect(loadedGraph.edges[0]?.from).toBe('nodeB')
    })

    it('overwrites existing graph with same name', async () => {
      const graph1: Graph = {
        name: 'test-graph',
        edges: [],
      }

      const graph2: Graph = {
        name: 'test-graph',
        nodes: [{ name: 'nodeA' }, { name: 'nodeB' }],
        edges: [{ from: 'nodeB', to: 'nodeA' }],
      }

      await saveCompiledGraph(graph1)
      await saveCompiledGraph(graph2)

      const loaded = await loadCompiledGraph('test-graph')
      expect(loaded.nodes).toHaveLength(2)
      expect(loaded.edges).toHaveLength(1)
    })

    it('loadCompiledGraph throws GraphNotFoundError for non-existent graph', async () => {
      await expect(loadCompiledGraph('non-existent')).rejects.toThrow(GraphNotFoundError)
      await expect(loadCompiledGraph('non-existent')).rejects.toThrow(
        "graph 'non-existent' not found",
      )
    })
  })

  describe('listGraphs', () => {
    it('returns empty array when no graphs exist', async () => {
      await fs.mkdir('.dagman/graphs', { recursive: true })
      const graphs = await listGraphs()
      expect(graphs).toEqual([])
    })

    it('lists multiple graphs', async () => {
      await createGraphFile('graph1', [{ name: 'a' }])
      await createGraphFile('graph2', [{ name: 'b' }])

      const graphs = await listGraphs()
      expect(graphs).toHaveLength(2)

      const names = graphs.map((g) => g.name).sort()
      expect(names).toEqual(['graph1', 'graph2'])
    })

    it('skips non-JSON files in graphs directory', async () => {
      await fs.mkdir('.dagman/graphs', { recursive: true })
      await createGraphFile('graph1', [{ name: 'a' }])
      // Create a non-JSON file
      await fs.writeFile('.dagman/graphs/readme.txt', 'not a graph', 'utf-8')

      const graphs = await listGraphs()
      expect(graphs).toHaveLength(1)
      expect(graphs[0]?.name).toBe('graph1')
    })

    it('skips malformed JSON files silently', async () => {
      await fs.mkdir('.dagman/graphs', { recursive: true })
      await createGraphFile('graph1', [{ name: 'a' }])
      // Create a malformed JSON file
      await fs.writeFile('.dagman/graphs/bad.json', '{ invalid json }', 'utf-8')

      const graphs = await listGraphs()
      expect(graphs).toHaveLength(1)
      expect(graphs[0]?.name).toBe('graph1')
    })
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
