/**
 * ASCII DAG renderer — produces lines of terminal-friendly graph art.
 *
 * Layout strategy: layer-based grid (topological layers → rows).
 *  1. Assign column positions to nodes within each layer
 *  2. Render node boxes row-by-row with consistent column widths
 *  3. Draw edge connections between rows (solid for plain, dashed for conditional)
 *  4. Apply color as a post-processing pass (keeps layout logic ANSI-free)
 *
 * All functions are pure — no I/O, no side effects.
 */

import type { VisualGraph, VisualNode } from './visual-graph.js'
import type { ColorTheme } from './color.js'

// ─── Layout Types ───────────────────────────────────────────────────

interface Position {
  nodeId: string
  col: number
  layer: number
}

interface Layout {
  positions: Map<string, Position>
  colCount: number
  maxNameLen: number
}

// ─── Box Characters ─────────────────────────────────────────────────

const BOX_TL = '╭'
const BOX_TR = '╮'
const BOX_BL = '╰'
const BOX_BR = '╯'
const BOX_H = '─'
const BOX_V = '│'
const ARROW_DOWN = '▼'
const ARROW_DASHED = '▽'
const COND_MARKER = '◇'

/** Gap between boxes in the same row */
const COL_GAP = 3

// ─── Sizing Helpers ─────────────────────────────────────────────────

function boxWidth(maxNameLen: number): number {
  return maxNameLen + 4
}

/** X position of center of a column */
function colCenterX(col: number, boxW: number): number {
  return col * (boxW + COL_GAP) + Math.floor(boxW / 2)
}

/** Total width of a row */
function rowWidth(colCount: number, boxW: number): number {
  return colCount * boxW + (colCount - 1) * COL_GAP
}

// ─── Layout Computation ─────────────────────────────────────────────

export function computeLayout(graph: VisualGraph): Layout {
  const positions = new Map<string, Position>()
  const maxNameLen = Math.max(...graph.nodes.map((n) => n.id.length), 4)
  const colCount = Math.max(...graph.layers.map((l) => l.length), 1)

  graph.layers.forEach((layer, layerIdx) => {
    const startCol = Math.floor((colCount - layer.length) / 2)
    layer.forEach((nodeId, i) => {
      positions.set(nodeId, { nodeId, col: startCol + i, layer: layerIdx })
    })
  })

  return { positions, colCount, maxNameLen }
}

// ─── Virtual Node Detection ─────────────────────────────────────────

function isVirtualNode(id: string): boolean {
  return id === 'START' || id === 'END'
}

// ─── Node Box Rendering (plain text) ────────────────────────────────

/**
 * Render a single node box as plain text (no ANSI).
 * Returns 3 lines: top, middle, bottom.
 * Virtual nodes get centered parentheses.
 */
function renderNodeBox(nodeId: string, boxW: number): string[] {
  if (isVirtualNode(nodeId)) {
    const label = `(${nodeId})`
    const centered = label.padStart(Math.floor((boxW + label.length) / 2)).padEnd(boxW)
    return ['', centered, '']
  }

  const padded = nodeId.padEnd(boxW - 4)
  const top = BOX_TL + BOX_H.repeat(boxW - 2) + BOX_TR
  const mid = BOX_V + ` ${padded} ` + BOX_V
  const bot = BOX_BL + BOX_H.repeat(boxW - 2) + BOX_BR

  return [top, mid, bot]
}

/** Place a content string into a row at position x, padded to boxW. */
function placeInRow(row: string, x: number, boxW: number, content: string): string {
  const padded = content.padEnd(boxW).slice(0, boxW)
  return row.slice(0, x) + padded + row.slice(x + boxW)
}

/** Render all boxes for one layer into full-width rows. */
function renderBoxRow(boxes: string[][], layerNodes: string[], layout: Layout): string[] {
  const boxW = boxWidth(layout.maxNameLen)
  const width = rowWidth(layout.colCount, boxW)
  const lineCount = boxes[0]?.length ?? 0

  const result: string[] = []
  for (let line = 0; line < lineCount; line++) {
    let row = ' '.repeat(width)
    for (let i = 0; i < layerNodes.length; i++) {
      const pos = layout.positions.get(layerNodes[i]!)!
      const x = pos.col * (boxW + COL_GAP)
      row = placeInRow(row, x, boxW, boxes[i]![line] ?? '')
    }
    result.push(rstrip(row))
  }
  return result
}

// ─── Edge Rendering (plain text grid) ───────────────────────────────

interface EdgeSegment {
  fromCol: number
  toCol: number
  conditional: boolean
}

/**
 * Render edges between two consecutive layers as plain text.
 * Uses a simple character grid — one char per position.
 */
function renderEdgesBetweenLayers(
  edges: EdgeSegment[],
  colCount: number,
  boxW: number,
): { lines: string[]; coloredPositions: Map<string, string> } {
  if (edges.length === 0) return { lines: [], coloredPositions: new Map() }

  const width = rowWidth(colCount, boxW)
  const lines: string[] = [' '.repeat(width), ' '.repeat(width)]
  const coloredPositions = new Map<string, string>()

  for (const edge of edges) {
    const fromX = colCenterX(edge.fromCol, boxW)
    const toX = colCenterX(edge.toCol, boxW)
    const colorKey = edge.conditional ? 'cond' : 'normal'
    const arrow = edge.conditional ? ARROW_DASHED : ARROW_DOWN

    if (fromX === toX) {
      setChar(lines, 0, fromX, BOX_V)
      setChar(lines, 1, fromX, arrow)
      coloredPositions.set(`0:${fromX}`, colorKey)
      coloredPositions.set(`1:${fromX}`, colorKey)
    } else {
      const minX = Math.min(fromX, toX)
      const maxX = Math.max(fromX, toX)

      // Line 0: stem from source
      const stemChar = edge.conditional ? COND_MARKER : BOX_V
      setChar(lines, 0, fromX, stemChar)
      coloredPositions.set(`0:${fromX}`, colorKey)

      // Line 1: horizontal route + junction + arrow
      for (let x = minX; x <= maxX; x++) {
        if (lines[1]![x] === ' ') {
          setChar(lines, 1, x, BOX_H)
          coloredPositions.set(`1:${x}`, colorKey)
        }
      }
      setChar(lines, 1, fromX, edge.conditional ? '┆' : '┬')
      setChar(lines, 1, toX, arrow)
      coloredPositions.set(`1:${fromX}`, colorKey)
      coloredPositions.set(`1:${toX}`, colorKey)
    }
  }

  return { lines: lines.map(rstrip), coloredPositions }
}

// ─── Plain String Helpers ───────────────────────────────────────────

function setChar(lines: string[], idx: number, pos: number, ch: string): void {
  const line = lines[idx]!
  if (pos >= line.length) {
    lines[idx] = line.padEnd(pos) + ch
  } else {
    lines[idx] = line.slice(0, pos) + ch + line.slice(pos + 1)
  }
}

/** Strip trailing whitespace. */
function rstrip(s: string): string {
  return s.replace(/\s+$/, '')
}

// ─── Color Post-Processing ──────────────────────────────────────────

/**
 * Apply color theme to a plain-text grid line.
 * - Virtual node lines: theme.virtual
 * - Box border lines: theme.dim
 * - Box middle lines: theme.node
 * - Edge lines: theme.edge or theme.condEdge based on coloredPositions
 */
function applyColorToBoxLine(line: string, lineIdx: number, theme: ColorTheme): string {
  if (line.trim() === '') return line
  if (lineIdx % 3 === 1) {
    // Middle line — check if it's a virtual node (parenthesized) or a real box
    const stripped = line.trim()
    if (stripped.startsWith('(')) {
      return theme.virtual(line)
    }
    return theme.node(line)
  }
  // Top/bottom border lines
  const stripped = line.trim()
  if (stripped.startsWith('(')) return line
  return theme.dim(line)
}

function applyColorToEdgeLines(
  lines: string[],
  coloredPositions: Map<string, string>,
  theme: ColorTheme,
): string[] {
  return lines.map((line, lineIdx) => {
    if (line.trim() === '') return line

    // Walk the line character by character
    let result = ''
    for (let x = 0; x < line.length; x++) {
      const ch = line[x]!
      if (ch === ' ') {
        result += ch
        continue
      }
      const key = `${lineIdx}:${x}`
      const colorType = coloredPositions.get(key)
      if (colorType === 'cond') {
        result += theme.condEdge(ch)
      } else {
        result += theme.edge(ch)
      }
    }
    return result
  })
}

// ─── Public Render API ──────────────────────────────────────────────

export function renderGraph(graph: VisualGraph, theme: ColorTheme): string[] {
  const layout = computeLayout(graph)
  const boxW = boxWidth(layout.maxNameLen)
  const result: string[] = []

  const nodeMap = new Map<string, VisualNode>()
  for (const n of graph.nodes) nodeMap.set(n.id, n)

  // Group edges by layer pair
  const edgesByLayerPair = new Map<string, EdgeSegment[]>()
  for (const edge of graph.edges) {
    const from = layout.positions.get(edge.from)
    const to = layout.positions.get(edge.to)
    if (!from || !to) continue
    const key = `${from.layer}:${to.layer}`
    const list = edgesByLayerPair.get(key) ?? []
    list.push({ fromCol: from.col, toCol: to.col, conditional: edge.conditional })
    edgesByLayerPair.set(key, list)
  }

  // Render layers as plain text, then apply color
  let globalLineIdx = 0

  for (let layerIdx = 0; layerIdx < graph.layers.length; layerIdx++) {
    const layerNodes = graph.layers[layerIdx]!

    // Render box rows (plain text)
    const boxes = layerNodes.map((id) => renderNodeBox(id, boxW))
    const boxRows = renderBoxRow(boxes, layerNodes, layout)

    // Apply color to box rows
    for (let i = 0; i < boxRows.length; i++) {
      result.push(applyColorToBoxLine(boxRows[i]!, i, theme))
      globalLineIdx++
    }

    // Render and color edges to next layer
    if (layerIdx < graph.layers.length - 1) {
      const key = `${layerIdx}:${layerIdx + 1}`
      const segments = edgesByLayerPair.get(key) ?? []
      const { lines: edgeLines, coloredPositions } = renderEdgesBetweenLayers(
        segments,
        layout.colCount,
        boxW,
      )
      result.push(...applyColorToEdgeLines(edgeLines, coloredPositions, theme))
      globalLineIdx += edgeLines.length
    }
  }

  return result
}
