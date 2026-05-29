import { promises as fs } from "fs";
import * as path from "path";
import {
  RUNS_DIR,
  CURRENT_RUN_FILE,
  DEFAULT_RUN_ID,
  getRunDir,
  getRunMetaFile,
} from "../constants.js";
import { ensureDir, readJSON, writeJSON, fileExists } from "../utils/file.js";
import { RunNotFoundError, RunExistsError } from "../errors.js";
import type { RunInfo, RunStatus } from "../models/superstep.js";
import * as graphService from "./graph-service.js";
import * as nodeService from "./node-service.js";
import * as workflowService from "./workflow-service.js";
import { computeTopologicalLayers } from "../utils/topology.js";

export type { RunInfo, RunStatus };

export async function getCurrentRunId(): Promise<string | null> {
  if (!(await fileExists(CURRENT_RUN_FILE))) {
    return null;
  }
  const content = await fs.readFile(path.resolve(CURRENT_RUN_FILE), "utf-8");
  return content.trim() || null;
}

export async function setCurrentRunId(runId: string): Promise<void> {
  await ensureDir(".dagman");
  await fs.writeFile(path.resolve(CURRENT_RUN_FILE), runId, "utf-8");
}

export async function resolveCurrentRunId(): Promise<string> {
  const current = await getCurrentRunId();
  if (current) return current;

  // Fresh start — legacy migration no longer supported
  await createRunInternal(DEFAULT_RUN_ID);
  await setCurrentRunId(DEFAULT_RUN_ID);
  return DEFAULT_RUN_ID;
}

async function createRunInternal(
  runId: string,
  label?: string,
  graphName?: string
): Promise<RunInfo> {
  const runDir = getRunDir(runId);
  if (await fileExists(getRunMetaFile(runId))) {
    throw new RunExistsError(runId);
  }

  await ensureDir(runDir);

  let layerAssignment: Record<string, number> | undefined;
  let currentStep = 0;
  let status: RunStatus = "idle";

  // If bound to a graph, compute layers and initialize workflow
  if (graphName) {
    const graph = await graphService.loadGraph(graphName);
    const nodes = await nodeService.listNodes();
    const nodeNames = nodes.map((n) => n.name);
    const layers = computeTopologicalLayers(graph.edges, nodeNames);

    layerAssignment = {};
    for (const [layer, names] of layers.entries()) {
      for (const name of names) {
        layerAssignment[name] = layer;
      }
    }

    status = "running";

    const info: RunInfo = {
      id: runId,
      createdAt: new Date().toISOString(),
      label,
      graphName,
      currentStep,
      status,
      layerAssignment,
    };
    await writeJSON(getRunMetaFile(runId), info);

    // Initialize workflow.jsonl
    await workflowService.initWorkflow(runId, layers, graph.edges);

    return info;
  }

  const info: RunInfo = {
    id: runId,
    createdAt: new Date().toISOString(),
    label,
    graphName,
    currentStep,
    status,
    layerAssignment,
  };
  await writeJSON(getRunMetaFile(runId), info);
  return info;
}

export async function createRun(
  label?: string,
  graphName?: string,
  switchTo?: boolean
): Promise<RunInfo> {
  const runId = label
    ? label
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
    : `run-${Date.now()}`;

  if (!runId) {
    throw new Error("could not generate valid run ID from label");
  }

  const info = await createRunInternal(runId, label, graphName);

  if (switchTo) {
    await setCurrentRunId(runId);
  }

  return info;
}

export async function listRuns(): Promise<RunInfo[]> {
  const runs: RunInfo[] = [];
  const abs = path.resolve(RUNS_DIR);

  try {
    const entries = await fs.readdir(abs);
    for (const entry of entries) {
      try {
        const metaFile = getRunMetaFile(entry);
        if (await fileExists(metaFile)) {
          const info = await readJSON<RunInfo>(metaFile);
          runs.push(info);
        }
      } catch {
        // skip invalid runs
      }
    }
  } catch {
    // runs dir doesn't exist
  }

  return runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function switchRun(runId: string): Promise<void> {
  if (!(await fileExists(getRunMetaFile(runId)))) {
    throw new RunNotFoundError(runId);
  }
  await setCurrentRunId(runId);
}

export async function getGraphForRun(runId: string): Promise<string | null> {
  const meta = await readJSON<RunInfo>(getRunMetaFile(runId));
  return meta.graphName ?? null;
}

export async function resolveRunId(runId?: string): Promise<string> {
  if (runId) return runId;
  return resolveCurrentRunId();
}

export async function showRun(
  runId: string
): Promise<RunInfo & { taskCount: number; completedTasks: number }> {
  const metaFile = getRunMetaFile(runId);
  if (!(await fileExists(metaFile))) {
    throw new RunNotFoundError(runId);
  }

  const info = await readJSON<RunInfo>(metaFile);

  let taskCount = 0;
  let completedTasks = 0;

  try {
    const currentStep = await workflowService.getCurrentStep(runId);
    taskCount = currentStep.tasks.length;
    completedTasks = currentStep.tasks.filter(
      (t) => t.status === "success" || t.status === "skipped"
    ).length;
  } catch {
    // workflow not initialized
  }

  return { ...info, taskCount, completedTasks };
}
