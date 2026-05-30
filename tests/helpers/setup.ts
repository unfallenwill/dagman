import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import { mkdtempSync } from 'fs'
import { setBasePath } from '../../src/infra/fs/paths.js'
import * as runService from '../../src/domain/run/run-service.js'
import { setDefaultSchedulingDeps } from '../../src/domain/scheduling/scheduler.js'
import { setDefaultRunDeps } from '../../src/domain/run/run-service.js'
import { setDefaultCompilerDeps } from '../../src/domain/compiler/compiler.js'
import type { Edge, Graph } from '../../src/shared/models/graph.js'
import type { Node } from '../../src/shared/models/node.js'
import type { WorkflowDefinition } from '../../src/shared/models/workflow-def.js'
import type { WorkflowLoader } from '../../src/shared/utils/loader.js'

let tmpDir: string

/**
 * Create a unique temporary directory, set it as dagman's basePath, and chdir into it.
 * Call this in beforeEach(). Call cleanupTmpDir() in afterEach().
 */
export function initTmpDir(): string {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'dagman-test-'))
  setBasePath(tmpDir)
  process.chdir(tmpDir)
  return tmpDir
}

/**
 * Reset basePath and remove the temporary directory.
 * Call this in afterEach().
 */
export async function cleanupTmpDir(): Promise<void> {
  setBasePath('')
  process.chdir(path.resolve('..'))
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

/** Get the current test's temporary directory path. */
export function getTmpDir(): string {
  return tmpDir
}

// ===== In-memory graph store for tests =====

const graphStore = new Map<string, Graph>()

/** Clear all stored graphs. Call in beforeEach(). */
export function clearGraphStore(): void {
  graphStore.clear()
}

/** Store a graph in the test graph store. */
export function storeGraph(name: string, graph: Graph): void {
  graphStore.set(name, graph)
}

/** Get a graph from the test graph store. */
export function getStoredGraph(name: string): Graph | undefined {
  return graphStore.get(name)
}

/** Create a mock loadGraph function that reads from the in-memory store. */
export function mockLoadGraph(graphName: string): Promise<Graph> {
  const g = graphStore.get(graphName)
  if (!g) throw new Error(`graph '${graphName}' not found in test store`)
  return Promise.resolve(g)
}

/**
 * Mock WorkflowLoader that returns a synthetic WorkflowDefinition
 * based on the stored graph. Extracts graph name from the file path.
 */
const mockLoader: WorkflowLoader = {
  async load(workflowPath: string): Promise<WorkflowDefinition> {
    // Extract graph name from path like .../.dagman/workflows/<name>/index.ts
    const match = workflowPath.match(/workflows\/([^/]+)\//)
    const graphName = match?.[1]
    if (!graphName) {
      throw new Error(`cannot extract graph name from path: ${workflowPath}`)
    }
    const graph = graphStore.get(graphName)
    if (!graph) {
      throw new Error(`graph '${graphName}' not found in test store`)
    }
    // Build a synthetic WorkflowDefinition from the stored graph
    const noOp = () => {}
    return {
      name: graphName,
      stateSchema: {},
      nodes: (graph.nodes ?? [])
        .filter((n) => n.kind === 'user' || !n.kind)
        .map((n) => ({
          name: n.name,
          fn: noOp,
          stateKey: n.stateKey,
        })),
      edges: graph.edges,
      condEdges: [],
      fanOuts: [],
    }
  },
}

/**
 * Install mock loadGraph into scheduling, run service, and compiler defaults.
 * Call this in beforeEach() after initTmpDir().
 */
export function installMockLoadGraph(): void {
  const loadGraph = (name: string) => mockLoadGraph(name)
  setDefaultSchedulingDeps({ loadGraph })
  setDefaultRunDeps({ loadGraph })
  setDefaultCompilerDeps({ loader: mockLoader })
}

/**
 * Create a compiled graph and a run instance. Returns the run ID.
 * Uses the in-memory graph store — no disk I/O for graph data.
 */
export async function setupCompiledRun(
  nodeNames: string[],
  edges: Edge[],
  graphName = 'test-graph',
): Promise<string> {
  const graph: Graph = {
    name: graphName,
    edges,
    nodes: nodeNames.map((name) => ({
      name,
      description: `Test node ${name}`,
      instructions: `Do work for ${name}`,
      kind: 'user' as const,
    })),
    workflowName: graphName,
  }
  storeGraph(graphName, graph)
  const info = await runService.createRun(undefined, graphName, true)
  return info.id
}

/**
 * Build a Graph object from node names and edges.
 */
export function buildGraph(
  nodeNames: string[],
  edges: Edge[],
  graphName = 'test-graph',
  nodeOverrides?: Partial<Node>,
): Graph {
  return {
    name: graphName,
    edges,
    nodes: nodeNames.map((name) => ({
      name,
      description: `Node ${name}`,
      instructions: `Instructions for ${name}`,
      kind: 'user' as const,
      ...nodeOverrides,
    })),
    workflowName: graphName,
  }
}
