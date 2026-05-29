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

async function createRunInternal(
  runId: string,
  label?: string,
  graphName?: string,
): Promise<RunInfo> {
  const runDir = getRunDir(runId)
  if (await fileExists(getRunMetaFile(runId))) {
    throw new RunExistsError(runId)
  }

  await ensureDir(runDir)

  let layerAssignment: Record<string, number> | undefined
  let currentStep = 0
  let status: RunStatus = 'idle'

  // If bound to a graph, compute layers and initialize workflow
  if (graphName) {
    // Try compiled JSON graph first (from TS workflow), then manifest YAML
    let graph
    try {
      graph = await graphService.loadCompiledGraph(graphName)
    } catch {
      graph = await graphService.loadGraph(graphName)
    }
    const nodes: Node[] = graph.nodes ?? []
    const nodeNames = nodes.map((n: Node) => n.name)
    const layers = computeTopologicalLayers(graph.edges, nodeNames)

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
    await writeJSON(getRunMetaFile(runId), info)

    // Initialize workflow.jsonl
    await workflowService.initWorkflow(runId, layers, graph.edges)

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
  await writeJSON(getRunMetaFile(runId), info)
  return info
}

export async function createRun(
  label?: string,
  graphName?: string,
  switchTo?: boolean,
  explicitRunId?: string,
): Promise<RunInfo> {
  let runId: string

  if (explicitRunId) {
    runId = explicitRunId
  } else if (graphName) {
    // When bound to a graph/workflow, generate <name>@<suffix>
    runId = generateInstanceId(graphName)
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

  const info = await createRunInternal(runId, label, graphName)

  if (switchTo) {
    await setCurrentRunId(runId)
  }

  return info
}

export async function listRuns(): Promise<RunInfo[]> {
  const runs: RunInfo[] = []
  const abs = path.resolve(getRunsDir())

  try {
    const entries = await fs.readdir(abs)
    for (const entry of entries) {
      try {
        const metaFile = getRunMetaFile(entry)
        if (await fileExists(metaFile)) {
          const info = await readJSON<RunInfo>(metaFile)
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

export async function switchRun(runId: string): Promise<void> {
  if (!(await fileExists(getRunMetaFile(runId)))) {
    throw new RunNotFoundError(runId)
  }
  await setCurrentRunId(runId)
}

export async function getGraphForRun(runId: string): Promise<string | null> {
  const meta = await readJSON<RunInfo>(getRunMetaFile(runId))
  return meta.graphName ?? null
}

export async function resolveRunId(runId?: string): Promise<string> {
  if (runId) return runId
  return resolveCurrentRunId()
}

export async function showRun(
  runId: string,
): Promise<RunInfo & { taskCount: number; completedTasks: number }> {
  const metaFile = getRunMetaFile(runId)
  if (!(await fileExists(metaFile))) {
    throw new RunNotFoundError(runId)
  }

  const info = await readJSON<RunInfo>(metaFile)

  let taskCount = 0
  let completedTasks = 0

  try {
    const currentStep = await workflowService.getCurrentStep(runId)
    taskCount = currentStep.tasks.length
    completedTasks = currentStep.tasks.filter(
      (t) => t.status === 'success' || t.status === 'skipped',
    ).length
  } catch {
    // workflow not initialized
  }

  return { ...info, taskCount, completedTasks }
}
