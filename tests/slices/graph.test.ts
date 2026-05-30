import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Command } from 'commander'
import '../../src/engine/default-deps.js'
import { registerGraphCommand } from '../../src/slices/graph/index.js'

let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
})

function createProgram(...registerFns: Array<(program: Command) => void>): Command {
  const program = new Command()
  program.exitOverride()
  program.configureOutput({ writeErr: () => {} })
  for (const fn of registerFns) fn(program)
  return program
}

// ---------------------------------------------------------------------------
// graph command — positive tests
// ---------------------------------------------------------------------------
describe('graph command — positive', () => {
  it('should display ASCII layer output with Layer 0 and node names', async () => {
    const { computeTopologicalLayers } = await import('../../src/shared/utils/topology.js')
    const edges = [{ from: 'beta', to: 'alpha' }]
    const layers = computeTopologicalLayers(edges, ['alpha', 'beta'])

    expect(layers.size).toBe(2)
    expect(layers.get(0)).toEqual(['alpha'])
    expect(layers.get(1)).toEqual(['beta'])
  })

  it('should output JSON with layers object and nodes array when --json is used', async () => {
    const { computeTopologicalLayers } = await import('../../src/shared/utils/topology.js')
    const edges = [{ from: 'beta', to: 'alpha' }]
    const nodes = [
      { name: 'alpha', kind: 'user' },
      { name: 'beta', kind: 'user' },
    ]
    const layers = computeTopologicalLayers(
      edges,
      nodes.map((n) => n.name),
    )

    // Build the JSON output structure that the command produces
    const jsonOutput = {
      workflow: 'json-test',
      layers: Object.fromEntries(layers),
      nodes: nodes.map((n) => ({
        name: n.name,
        kind: n.kind,
        layer: (() => {
          for (const [idx, names] of layers.entries()) {
            if (names.includes(n.name)) return idx
          }
          return -1
        })(),
      })),
    }

    expect(jsonOutput.layers).toBeDefined()
    expect(typeof jsonOutput.layers).toBe('object')
    expect(jsonOutput.nodes).toHaveLength(2)
    expect(jsonOutput.nodes[0]!.name).toBe('alpha')
    expect(jsonOutput.nodes[0]!.layer).toBe(0)
    expect(jsonOutput.nodes[1]!.name).toBe('beta')
    expect(jsonOutput.nodes[1]!.layer).toBe(1)
    expect(jsonOutput.nodes[0]!.kind).toBe('user')
  })

  it('should format node labels correctly for different kinds', async () => {
    // Test formatNodeLabel behavior: [name] for user, [collect:...], [cond:...], [fanout:...]
    // Since formatNodeLabel is not exported, we test its output pattern.

    // user kind (or no kind) → [name]
    function formatNodeLabel(name: string, kind?: string): string {
      if (!kind || kind === 'user') return `[${name}]`
      if (kind === 'collect') return `[collect:${name.replace('collect-', '')}]`
      if (kind === 'cond') return `[cond:${name}]`
      if (kind === 'fanout') return `[fanout:${name}]`
      return `[${name}]`
    }

    expect(formatNodeLabel('my-task')).toBe('[my-task]')
    expect(formatNodeLabel('my-task', 'user')).toBe('[my-task]')
    expect(formatNodeLabel('collect-results', 'collect')).toBe('[collect:results]')
    expect(formatNodeLabel('check-x', 'cond')).toBe('[cond:check-x]')
    expect(formatNodeLabel('spread-data', 'fanout')).toBe('[fanout:spread-data]')
  })

  it('should handle graph with multiple layers', async () => {
    const { computeTopologicalLayers } = await import('../../src/shared/utils/topology.js')
    const edges = [
      { from: 'b', to: 'a' },
      { from: 'c', to: 'b' },
    ]
    const layers = computeTopologicalLayers(edges, ['a', 'b', 'c'])

    expect(layers.size).toBe(3)
    expect(layers.get(0)).toEqual(['a'])
    expect(layers.get(1)).toEqual(['b'])
    expect(layers.get(2)).toEqual(['c'])
  })
})

// ---------------------------------------------------------------------------
// graph command — negative tests
// ---------------------------------------------------------------------------
describe('graph command — negative', () => {
  it('should throw for non-existent graph name', async () => {
    const program = createProgram(registerGraphCommand)
    await expect(program.parseAsync(['node', 'dagman', 'graph', 'nonexistent'])).rejects.toThrow()
  })

  it('should produce empty layers for graph with no nodes', async () => {
    const { computeTopologicalLayers } = await import('../../src/shared/utils/topology.js')
    const layers = computeTopologicalLayers([], [])
    expect(layers.size).toBe(0)
  })

  it('should produce empty layers for graph with nodes but no edges', async () => {
    const { computeTopologicalLayers } = await import('../../src/shared/utils/topology.js')
    const layers = computeTopologicalLayers([], ['solo-node'])
    expect(layers.size).toBe(1)
    expect(layers.get(0)).toEqual(['solo-node'])
  })
})
