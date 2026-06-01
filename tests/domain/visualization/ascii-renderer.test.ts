import { describe, it, expect } from 'vitest'
import { computeLayout, renderGraph } from '../../../src/domain/visualization/ascii-renderer.js'
import { createTheme } from '../../../src/domain/visualization/color.js'
import type { VisualGraph } from '../../../src/domain/visualization/visual-graph.js'

// ─── No-color theme for deterministic output ────────────────────────

const noColor = createTheme(false)

// ─── Graph builders ─────────────────────────────────────────────────

function makeVisualGraph(
  layers: string[][],
  edges: Array<{ from: string; to: string; conditional?: boolean }>,
): VisualGraph {
  const nodes = layers.flat().map((id) => ({
    id,
    layer: layers.findIndex((l) => l.includes(id)),
    isVirtual: id === 'START' || id === 'END',
  }))
  return {
    nodes,
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      conditional: e.conditional ?? false,
    })),
    layers,
  }
}

/** START → A → B → END */
function makeLinearGraph(): VisualGraph {
  return makeVisualGraph(
    [['START'], ['A'], ['B'], ['END']],
    [
      { from: 'START', to: 'A' },
      { from: 'A', to: 'B' },
      { from: 'B', to: 'END' },
    ],
  )
}

/** START → [A, B] → END */
function makeParallelGraph(): VisualGraph {
  return makeVisualGraph(
    [['START'], ['A', 'B'], ['END']],
    [
      { from: 'START', to: 'A' },
      { from: 'START', to: 'B' },
      { from: 'A', to: 'END' },
      { from: 'B', to: 'END' },
    ],
  )
}

/** START → [A, B, C] → D → END (fan-out + fan-in) */
function makeFanOutFanInGraph(): VisualGraph {
  return makeVisualGraph(
    [['START'], ['A', 'B', 'C'], ['D'], ['END']],
    [
      { from: 'START', to: 'A' },
      { from: 'START', to: 'B' },
      { from: 'START', to: 'C' },
      { from: 'A', to: 'D' },
      { from: 'B', to: 'D' },
      { from: 'C', to: 'D' },
      { from: 'D', to: 'END' },
    ],
  )
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('ascii-renderer', () => {
  describe('computeLayout', () => {
    it('should assign col 0 for single-node layer', () => {
      const graph = makeLinearGraph()
      const layout = computeLayout(graph)

      expect(layout.colCount).toBe(1)
      expect(layout.positions.get('A')?.col).toBe(0)
      expect(layout.positions.get('B')?.col).toBe(0)
    })

    it('should assign sequential cols for multi-node layer', () => {
      const graph = makeParallelGraph()
      const layout = computeLayout(graph)

      expect(layout.colCount).toBe(2)
      expect(layout.positions.get('A')?.col).toBe(0)
      expect(layout.positions.get('B')?.col).toBe(1)
    })

    it('should compute maxNameLen from longest node ID', () => {
      const graph = makeVisualGraph(
        [['START'], ['short', 'very-long-name'], ['END']],
        [
          { from: 'START', to: 'short' },
          { from: 'START', to: 'very-long-name' },
          { from: 'short', to: 'END' },
          { from: 'very-long-name', to: 'END' },
        ],
      )
      const layout = computeLayout(graph)

      expect(layout.maxNameLen).toBe('very-long-name'.length)
    })

    it('should center narrower layers within wider column space', () => {
      const graph = makeFanOutFanInGraph()
      const layout = computeLayout(graph)

      // Layer [D] has 1 node, max colCount is 3
      expect(layout.colCount).toBe(3)
      // D should be centered: floor((3-1)/2) = col 1
      expect(layout.positions.get('D')?.col).toBe(1)
      // START should be centered: floor((3-1)/2) = col 1
      expect(layout.positions.get('START')?.col).toBe(1)
      // END should be centered: floor((3-1)/2) = col 1
      expect(layout.positions.get('END')?.col).toBe(1)
    })

    it('should use minimum maxNameLen of 4', () => {
      // All node IDs are very short (A, B)
      const graph = makeLinearGraph()
      const layout = computeLayout(graph)

      expect(layout.maxNameLen).toBeGreaterThanOrEqual(4)
    })
  })

  describe('renderGraph', () => {
    it('should produce output lines for a linear graph', () => {
      const graph = makeLinearGraph()
      const lines = renderGraph(graph, noColor)

      expect(lines.length).toBeGreaterThan(0)
    })

    it('should include node names in the output', () => {
      const graph = makeLinearGraph()
      const lines = renderGraph(graph, noColor)

      const text = lines.join('\n')
      expect(text).toContain('A')
      expect(text).toContain('B')
    })

    it('should render START and END with parentheses', () => {
      const graph = makeLinearGraph()
      const lines = renderGraph(graph, noColor)

      const text = lines.join('\n')
      expect(text).toContain('(START)')
      expect(text).toContain('(END)')
    })

    it('should include edge characters between layers', () => {
      const graph = makeLinearGraph()
      const lines = renderGraph(graph, noColor)

      const text = lines.join('\n')
      expect(text).toContain('│')
      expect(text).toContain('▼')
    })

    it('should render parallel nodes on the same row', () => {
      const graph = makeParallelGraph()
      const lines = renderGraph(graph, noColor)

      // Find a line that contains both A and B
      const abLine = lines.find((l) => l.includes('A') && l.includes('B'))
      expect(abLine).toBeDefined()
    })

    it('should produce no ANSI codes when theme is disabled', () => {
      const graph = makeLinearGraph()
      const lines = renderGraph(graph, noColor)

      for (const line of lines) {
        expect(line).not.toMatch(/\x1B\[/)
      }
    })

    it('should produce same visible output with enabled theme', () => {
      // picocolors auto-detects TTY — in test env it may not emit ANSI,
      // but the visible output must be identical to the no-color version
      const graph = makeLinearGraph()
      const plainLines = renderGraph(graph, noColor)
      const colorLines = renderGraph(graph, createTheme(true))

      const stripped = colorLines.map((l) => l.replace(/\x1B\[[0-9;]*m/g, ''))
      expect(stripped).toEqual(plainLines)
    })

    it('should use box-drawing characters for node borders', () => {
      const graph = makeLinearGraph()
      const lines = renderGraph(graph, noColor)

      const text = lines.join('\n')
      expect(text).toContain('╭')
      expect(text).toContain('╮')
      expect(text).toContain('╰')
      expect(text).toContain('╯')
    })

    it('should handle fan-out/fan-in with horizontal routing', () => {
      const graph = makeFanOutFanInGraph()
      const lines = renderGraph(graph, noColor)

      const text = lines.join('\n')
      // Horizontal routing uses ─ and ┬
      expect(text).toContain('─')
      expect(text).toContain('┬')
    })

    it('should use conditional markers for conditional edges', () => {
      const graph = makeVisualGraph(
        [['START'], ['A'], ['B', 'C'], ['END']],
        [
          { from: 'START', to: 'A' },
          { from: 'A', to: 'B', conditional: true },
          { from: 'A', to: 'C', conditional: true },
          { from: 'B', to: 'END' },
          { from: 'C', to: 'END' },
        ],
      )
      const lines = renderGraph(graph, noColor)
      const text = lines.join('\n')

      // Conditional edges use ◇ (diamond) and ▽ (dashed arrow)
      expect(text).toContain('◇')
      expect(text).toContain('▽')
    })

    it('should produce identical visible output regardless of color', () => {
      const graph = makeLinearGraph()
      const plainLines = renderGraph(graph, noColor)
      const colorLines = renderGraph(graph, createTheme(true))

      // Strip ANSI from colored output for comparison
      const strippedColor = colorLines.map((l) => l.replace(/\x1B\[[0-9;]*m/g, ''))

      expect(strippedColor).toEqual(plainLines)
    })

    it('should not crash for minimal graph (START + END only)', () => {
      const graph = makeVisualGraph([['START'], ['END']], [{ from: 'START', to: 'END' }])
      const lines = renderGraph(graph, noColor)

      expect(lines.length).toBeGreaterThan(0)
      const text = lines.join('\n')
      expect(text).toContain('(START)')
      expect(text).toContain('(END)')
    })
  })
})
