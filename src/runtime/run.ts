import { promises as fs } from 'fs'
import * as path from 'path'
import { getRunDir, getRunMetaFile, getRunsDir } from '../infra/fs/paths.js'
import { ensureDir, readJSON, writeJSON, fileExists } from '../infra/fs/file-ops.js'
import { RunNotFoundError, RunExistsError } from '../shared/errors.js'
import type { RunInfo, RunStatus } from '../shared/models/superstep.js'
import type { Node } from '../shared/models/node.js'
import * as graphService from '../graph/graph.js'
import * as workflowService from '../workflow/workflow.js'
import { computeTopologicalLayers } from '../shared/utils/topology.js'
import { generateInstanceId } from '../shared/utils/id.js'
import { setCurrentRunId, resolveCurrentRunId } from '../shared/utils/run-resolver.js'

export type { RunInfo, RunStatus }
export {
  getCurrentRunId,
  setCurrentRunId,
  resolveCurrentRunId,
  resolveActiveRunId,
  listRunIds,
} from '../shared/utils/run-resolver.js'

// ===== Dependency Injection =====

export interface RunDeps {
  getRunDir?: typeof getRunDir
  getRunMetaFile?: typeof getRunMetaFile
  getRunsDir?: typeof getRunsDir
  ensureDir?: typeof ensureDir
  readJSON?: typeof readJSON
  writeJSON?: typeof writeJSON
  fileExists?: typeof fileExists
  readdir?: (path: string) => Promise<string[]>
  loadCompiledGraph?: typeof graphService.loadCompiledGraph
  loadGraph?: typeof graphService.loadGraph
  initWorkflow?: typeof workflowService.initWorkflow
  getCurrentStep?: typeof workflowService.getCurrentStep
  computeTopologicalLayers?: typeof computeTopologicalLayers
  generateInstanceId?: typeof generateInstanceId
  setCurrentRunId?: typeof setCurrentRunId
  resolveCurrentRunId?: typeof resolveCurrentRunId
}

function resolveRunDeps(deps?: RunDeps) {
  return {
    getRunDir: deps?.getRunDir ?? getRunDir,
    getRunMetaFile: deps?.getRunMetaFile ?? getRunMetaFile,
    getRunsDir: deps?.getRunsDir ?? getRunsDir,
    ensureDir: deps?.ensureDir ?? ensureDir,
    readJSON: deps?.readJSON ?? readJSON,
    writeJSON: deps?.writeJSON ?? writeJSON,
    fileExists: deps?.fileExists ?? fileExists,
    readdir: deps?.readdir ?? ((dir: string) => fs.readdir(dir)),
    loadCompiledGraph: deps?.loadCompiledGraph ?? graphService.loadCompiledGraph,
    loadGraph: deps?.loadGraph ?? graphService.loadGraph,
    initWorkflow: deps?.initWorkflow ?? workflowService.initWorkflow,
    getCurrentStep: deps?.getCurrentStep ?? workflowService.getCurrentStep,
    computeTopologicalLayers: deps?.computeTopologicalLayers ?? computeTopologicalLayers,
    generateInstanceId: deps?.generateInstanceId ?? generateInstanceId,
    setCurrentRunId: deps?.setCurrentRunId ?? setCurrentRunId,
    resolveCurrentRunId: deps?.resolveCurrentRunId ?? resolveCurrentRunId,
  }
}

async function createRunInternal(
  runId: string,
  label?: string,
  graphName?: string,
  deps?: RunDeps,
): Promise<RunInfo> {
  const d = resolveRunDeps(deps)
  const runDir = d.getRunDir(runId)
  if (await d.fileExists(d.getRunMetaFile(runId))) {
    throw new RunExistsError(runId)
  }

  await d.ensureDir(runDir)

  let layerAssignment: Record<string, number> | undefined
  let currentStep = 0
  let status: RunStatus = 'idle'

  // If bound to a graph, compute layers and initialize workflow
  if (graphName) {
    // Try compiled JSON graph first (from TS workflow), then manifest YAML
    let graph
    try {
      graph = await d.loadCompiledGraph(graphName)
    } catch {
      graph = await d.loadGraph(graphName)
    }
    const nodes: Node[] = graph.nodes ?? []
    const nodeNames = nodes.map((n: Node) => n.name)
    const layers = d.computeTopologicalLayers(graph.edges, nodeNames)

    layerAssignment = {}
    for (const [layer, names] of layers.entries()) {
      for (const name of names) {
        layerAssignment[name] = layer
      }
    }

    status = 'running'

    const info: RunInfo = {
      id: runId,
      createdAt: new Date().toISOString(),
      label,
      graphName,
      currentStep,
      status,
      layerAssignment,
    }
    await d.writeJSON(d.getRunMetaFile(runId), info)

    // Initialize workflow.jsonl
    await d.initWorkflow(runId, layers, graph.edges)

    return info
  }

  const info: RunInfo = {
    id: runId,
    createdAt: new Date().toISOString(),
    label,
    graphName,
    currentStep,
    status,
    layerAssignment,
  }
  await d.writeJSON(d.getRunMetaFile(runId), info)
  return info
}

export async function createRun(
  label?: string,
  graphName?: string,
  switchTo?: boolean,
  explicitRunId?: string,
  deps?: RunDeps,
): Promise<RunInfo> {
  const d = resolveRunDeps(deps)
  let runId: string

  if (explicitRunId) {
    runId = explicitRunId
  } else if (graphName) {
    // When bound to a graph/workflow, generate <name>@<suffix>
    runId = d.generateInstanceId(graphName)
  } else if (label) {
    // Otherwise use sanitized label
    runId = label
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
    if (!runId) {
      throw new Error('could not generate valid run ID from label')
    }
  } else {
    // Fallback to timestamp-based ID
    runId = `run-${Date.now()}`
  }

  const info = await createRunInternal(runId, label, graphName, deps)

  if (switchTo) {
    await d.setCurrentRunId(runId)
  }

  return info
}

export async function listRuns(deps?: RunDeps): Promise<RunInfo[]> {
  const d = resolveRunDeps(deps)
  const runs: RunInfo[] = []
  const abs = path.resolve(d.getRunsDir())

  try {
    const entries = await d.readdir(abs)
    for (const entry of entries) {
      try {
        const metaFile = d.getRunMetaFile(entry)
        if (await d.fileExists(metaFile)) {
          const info = await d.readJSON<RunInfo>(metaFile)
          runs.push(info)
        }
      } catch {
        // skip invalid runs
      }
    }
  } catch {
    // runs dir doesn't exist
  }

  return runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function switchRun(runId: string, deps?: RunDeps): Promise<void> {
  const d = resolveRunDeps(deps)
  if (!(await d.fileExists(d.getRunMetaFile(runId)))) {
    throw new RunNotFoundError(runId)
  }
  await d.setCurrentRunId(runId)
}

export async function getGraphForRun(runId: string, deps?: RunDeps): Promise<string | null> {
  const d = resolveRunDeps(deps)
  const meta = await d.readJSON<RunInfo>(d.getRunMetaFile(runId))
  return meta.graphName ?? null
}

export async function resolveRunId(runId?: string, deps?: RunDeps): Promise<string> {
  if (runId) return runId
  const d = resolveRunDeps(deps)
  return d.resolveCurrentRunId()
}

export async function showRun(
  runId: string,
  deps?: RunDeps,
): Promise<RunInfo & { taskCount: number; completedTasks: number }> {
  const d = resolveRunDeps(deps)
  const metaFile = d.getRunMetaFile(runId)
  if (!(await d.fileExists(metaFile))) {
    throw new RunNotFoundError(runId)
  }

  const info = await d.readJSON<RunInfo>(metaFile)

  let taskCount = 0
  let completedTasks = 0

  try {
    const currentStep = await d.getCurrentStep(runId)
    taskCount = currentStep.tasks.length
    completedTasks = currentStep.tasks.filter(
      (t) => t.status === 'success' || t.status === 'skipped',
    ).length
  } catch {
    // workflow not initialized
  }

  return { ...info, taskCount, completedTasks }
}
