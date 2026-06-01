/**
 * E2E tests for the unified StorageBackend.
 *
 * Validates the full data flow through the backend:
 * - initRun writes state/channels/tasks/run/graph via backend
 * - CLI next command reads data via getStorageBackend()
 * - Graph ref round-trip
 * - State persistence across steps
 * - Channel trigger/barrier mechanics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../src/engine/default-deps.js'
import { initTmpDir, cleanupTmpDir } from './helpers/setup.js'
import { initRun, setDefaultEngineDeps } from '../src/domain/engine/execution-engine.js'
import { setCurrentRunId } from '../src/domain/run/run-resolver.js'
import { getStorageBackend } from '../src/infra/storage/backend-instance.js'
import { resetConfig } from '../src/infra/storage/config-loader.js'
import type { CompiledGraph } from '../src/shared/models/compiled-graph.js'

beforeEach(() => {
  initTmpDir()
  resetConfig()
})

afterEach(async () => {
  await cleanupTmpDir()
})

// ── Test Graph Builder ────────────────────────────────────────────────

function buildTestGraph(
  nodeNames: string[],
  edges: Array<{ from: string; to: string }> = [],
  graphName = 'e2e-storage',
  stateSchema: Record<string, unknown> = {},
): CompiledGraph {
  const noOp = (_state: Record<string, unknown>) => ({}) as Record<string, unknown>

  const targetToSources = new Map<string, string[]>()
  for (const edge of edges) {
    const sources = targetToSources.get(edge.to) ?? []
    sources.push(edge.from)
    targetToSources.set(edge.to, sources)
  }

  const channels: CompiledGraph['channels'] = {}
  const nodeStrategies: Record<string, Array<{ type: 'direct'; channel: string }>> = {}
  const nodeTrigger: Record<string, string> = {}

  for (const name of nodeNames) {
    nodeStrategies[name] = []
  }

  for (const [target, sources] of targetToSources) {
    if (sources.length === 1) {
      const channelName = `trigger:${target}`
      channels[channelName] = { name: channelName, type: 'trigger' }
      nodeTrigger[target] = channelName
      nodeStrategies[sources[0]!]!.push({ type: 'direct', channel: channelName })
    } else {
      const channelName = `barrier:${target}`
      channels[channelName] = { name: channelName, type: 'barrier', writers: sources }
      nodeTrigger[target] = channelName
      for (const source of sources) {
        nodeStrategies[source]!.push({ type: 'direct', channel: channelName })
      }
    }
  }

  const nodes: Record<string, CompiledGraph['nodes'][string]> = {}
  for (const name of nodeNames) {
    nodes[name] = {
      id: name,
      fn: noOp,
      strategies: nodeStrategies[name] ?? [],
      triggeredBy: nodeTrigger[name] ?? `entry:${name}`,
    }
  }

  const layers = computeSimpleLayers(nodeNames, edges)

  return {
    name: graphName,
    nodes,
    stateSchema,
    channels,
    layers,
  }
}

function computeSimpleLayers(
  nodeNames: string[],
  edges: Array<{ from: string; to: string }>,
): string[][] {
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const name of nodeNames) inDegree.set(name, 0)

  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1)
    const list = dependents.get(edge.from) ?? []
    list.push(edge.to)
    dependents.set(edge.from, list)
  }

  const layers: string[][] = []
  const assigned = new Set<string>()
  let currentLayer = [...inDegree.entries()].filter(([, deg]) => deg === 0).map(([name]) => name)

  while (currentLayer.length > 0) {
    layers.push(currentLayer)
    for (const name of currentLayer) assigned.add(name)
    const nextLayer: string[] = []
    for (const name of currentLayer) {
      for (const dep of dependents.get(name) ?? []) {
        if (assigned.has(dep)) continue
        const newDeg = inDegree.get(dep)! - 1
        inDegree.set(dep, newDeg)
        if (newDeg === 0 && !assigned.has(dep)) {
          nextLayer.push(dep)
        }
      }
    }
    currentLayer = nextLayer
  }

  return layers
}

async function setupRun(
  nodeNames: string[],
  edges: Array<{ from: string; to: string }> = [],
  graphName = 'e2e-storage',
  stateSchema: Record<string, unknown> = {},
): Promise<{ runId: string; graph: CompiledGraph }> {
  const graph = buildTestGraph(nodeNames, edges, graphName, stateSchema)
  const runId = `${graphName}@test123`
  await initRun(runId, graph)
  await setCurrentRunId(runId)

  setDefaultEngineDeps({
    compileWorkflow: async (name: string) => {
      if (name === graphName) return graph
      throw new Error(`unknown graph '${name}'`)
    },
  })

  return { runId, graph }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('E2E: StorageBackend — initRun persistence', () => {
  it('persists state.json via backend after initRun', async () => {
    const { runId } = await setupRun(['A'], [], 'state-test', { count: 0 })

    const backend = getStorageBackend()
    const state = await backend.readState(runId)
    expect(state).toEqual({ count: 0 })
  })

  it('persists channels.json via backend after initRun', async () => {
    const { runId } = await setupRun(['A', 'B'], [{ from: 'A', to: 'B' }], 'channel-test')

    const backend = getStorageBackend()
    const channels = await backend.readAllChannels(runId)
    expect(channels['trigger:B']).toBeDefined()
    expect(channels['trigger:B']!.type).toBe('trigger')
    expect(channels['trigger:B']!.version).toBe(0)
  })

  it('persists run.json via backend after initRun', async () => {
    const { runId } = await setupRun(['A'], [], 'runinfo-test')

    const backend = getStorageBackend()
    const info = await backend.readRunInfo(runId)
    expect(info.id).toBe(runId)
    expect(info.status).toBe('running')
    expect(info.graphName).toBe('runinfo-test')
  })

  it('persists graph.json via backend after initRun', async () => {
    const { runId } = await setupRun(['A'], [], 'graph-test')

    const backend = getStorageBackend()
    const graphRef = await backend.readGraphRef<{
      name: string
      nodeIds: string[]
      layers: string[][]
    }>(runId)
    expect(graphRef.name).toBe('graph-test')
    expect(graphRef.nodeIds).toEqual(['A'])
    expect(graphRef.layers).toEqual([['A']])
  })
})

describe('E2E: StorageBackend — data round-trip through CLI', () => {
  it('backend reads state written by node execution', async () => {
    const graph: CompiledGraph = {
      name: 'state-rt',
      nodes: {
        A: {
          id: 'A',
          fn: () => ({ result: 'hello' }),
          strategies: [],
          triggeredBy: 'entry:A',
        },
      },
      stateSchema: { result: null },
      channels: {},
      layers: [['A']],
    }
    const runId = 'state-rt@abc'
    await initRun(runId, graph)
    await setCurrentRunId(runId)
    setDefaultEngineDeps({
      compileWorkflow: async (name) => {
        if (name === 'state-rt') return graph
        throw new Error(`unknown graph '${name}'`)
      },
    })

    // Execute step (runs node A which writes { result: 'hello' })
    const { executeStep } = await import('../src/domain/engine/execution-engine.js')
    await executeStep(runId)

    // Verify state persisted through backend
    const backend = getStorageBackend()
    const state = await backend.readState(runId)
    expect(state.result).toBe('hello')
  })

  it('backend reads tasks after execution', async () => {
    const { runId } = await setupRun(['A'], [], 'task-rt')

    const { executeStep } = await import('../src/domain/engine/execution-engine.js')
    await executeStep(runId)

    const backend = getStorageBackend()
    const tasks = await backend.readAllTasks(runId)
    expect(tasks.length).toBe(1)
    expect(tasks[0]!.nodeId).toBe('A')
    expect(tasks[0]!.status).toBe('success')
  })

  it('backend reads updated channels after A→B execution', async () => {
    const { runId } = await setupRun(['A', 'B'], [{ from: 'A', to: 'B' }], 'chan-rt')

    const { executeStep } = await import('../src/domain/engine/execution-engine.js')
    await executeStep(runId) // Execute A, triggers B's channel

    const backend = getStorageBackend()
    const ch = await backend.readChannel(runId, 'trigger:B')
    expect(ch).not.toBeNull()
    expect(ch!.version).toBe(1) // Triggered by A
  })
})

describe('E2E: StorageBackend — config loading', () => {
  it('loads default config (json backend) when no config file exists', async () => {
    const { loadConfig } = await import('../src/infra/storage/config-loader.js')
    resetConfig()
    const config = loadConfig()
    expect(config.storage.type).toBe('json')
  })

  it('getStorageBackend returns a working backend', async () => {
    const backend = getStorageBackend()

    // Quick smoke test: write and read a run
    const info = {
      id: 'smoke-test',
      createdAt: '2026-01-01T00:00:00.000Z',
      currentStep: 0,
      currentStepScheduled: false,
      status: 'idle' as const,
    }
    await backend.createRunInfo(info)
    const read = await backend.readRunInfo('smoke-test')
    expect(read.id).toBe('smoke-test')
  })
})

describe('E2E: StorageBackend — barrier channel with fan-in', () => {
  it('correctly handles barrier when both writers complete', async () => {
    const { runId } = await setupRun(
      ['A', 'B', 'C'],
      [
        { from: 'A', to: 'C' },
        { from: 'B', to: 'C' },
      ],
      'barrier-test',
    )

    const backend = getStorageBackend()
    const { executeStep } = await import('../src/domain/engine/execution-engine.js')

    // Step 0: Execute A and B (parallel layer)
    await executeStep(runId)

    // Both writers should have written to barrier:C
    const barrier = await backend.readChannel(runId, 'barrier:C')
    expect(barrier!.type).toBe('barrier')
    expect(barrier!.version).toBe(1) // Completed
    expect(barrier!.type).toBe('barrier')
    expect((barrier as { received: string[] }).received.sort()).toEqual(['A', 'B'])

    // Step 1: execute C (auto-scheduled by executeStep Phase B)
    await executeStep(runId)

    const tasks = await backend.readTasksByStep(runId, 1)
    expect(tasks.length).toBe(1)
    expect(tasks[0]!.nodeId).toBe('C')
    expect(tasks[0]!.status).toBe('success')
  })
})
