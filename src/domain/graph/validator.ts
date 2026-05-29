import type { Edge } from '../../shared/models/graph.js'
import {
  hasCycle,
  findCyclePaths,
  findMissingTargets,
  findOrphanNodes,
} from '../../shared/utils/topology.js'

export interface ValidationResult {
  rule: string
  passed: boolean
  level: 'error' | 'warning'
  message: string
}

export function validateGraph(nodeNames: string[], edges: Edge[]): ValidationResult[] {
  if (nodeNames.length === 0) {
    return [
      {
        rule: 'empty-graph',
        passed: true,
        level: 'warning',
        message: 'task graph is empty, nothing to validate',
      },
    ]
  }

  const results: ValidationResult[] = []
  const nameSet = new Set(nodeNames)
  results.push(...checkMissingDeps(edges, nameSet))
  results.push(...checkInvalidStatus(edges))
  results.push(...checkCycles(edges))
  results.push(...checkOrphans(edges, nameSet))
  return results
}

export function checkMissingDeps(edges: Edge[], nodeNames: Set<string>): ValidationResult[] {
  const results: ValidationResult[] = []
  const missing = findMissingTargets(edges, nodeNames)

  for (const { edge, side } of missing) {
    const missingName = side === 'from' ? edge.from : edge.to
    results.push({
      rule: 'missing-dep',
      passed: false,
      level: 'error',
      message: `edge references non-existent node '${missingName}' (${side}: ${side === 'from' ? edge.from : edge.to})`,
    })
  }

  return results
}

const VALID_EXPECT_STATUSES = ['success', 'skipped']

export function checkInvalidStatus(edges: Edge[]): ValidationResult[] {
  const results: ValidationResult[] = []

  for (const edge of edges) {
    if (edge.expect !== undefined && !VALID_EXPECT_STATUSES.includes(edge.expect)) {
      results.push({
        rule: 'invalid-status',
        passed: false,
        level: 'error',
        message: `edge '${edge.from}' -> '${edge.to}' has invalid expect status '${edge.expect}', supported: ${VALID_EXPECT_STATUSES.join(', ')}`,
      })
    }
  }

  return results
}

export function checkCycles(edges: Edge[]): ValidationResult[] {
  if (!hasCycle(edges)) {
    return []
  }

  const results: ValidationResult[] = []
  const cyclePaths = findCyclePaths(edges)

  for (const cycle of cyclePaths) {
    results.push({
      rule: 'cycle',
      passed: false,
      level: 'error',
      message: `cycle detected: ${cycle.join(' -> ')}`,
    })
  }

  return results
}

export function checkOrphans(edges: Edge[], nodeNames: Set<string>): ValidationResult[] {
  const orphans = findOrphanNodes(edges, nodeNames)
  return orphans.map((name) => ({
    rule: 'orphan',
    passed: false,
    level: 'warning' as const,
    message: `node '${name}' is orphaned (no dependencies)`,
  }))
}

export function formatValidationResults(results: ValidationResult[]): string {
  const hasErrors = results.some((r) => r.level === 'error' && !r.passed)
  const hasWarnings = results.some((r) => r.level === 'warning' && !r.passed)

  if (!hasErrors && !hasWarnings) {
    // Check if it's the empty-graph hint
    const emptyGraph = results.find((r) => r.rule === 'empty-graph')
    if (emptyGraph) {
      return emptyGraph.message
    }
    return 'task graph validation passed, no issues'
  }

  const errors = results.filter((r) => r.level === 'error' && !r.passed)
  const warnings = results.filter((r) => r.level === 'warning' && !r.passed)

  const lines: string[] = []
  for (const err of errors) {
    lines.push(`[ERROR] ${err.message}`)
  }
  for (const warn of warnings) {
    lines.push(`[WARNING] ${warn.message}`)
  }

  return lines.join('\n')
}
