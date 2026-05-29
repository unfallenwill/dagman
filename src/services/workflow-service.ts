import { promises as fs } from "fs";
import * as path from "path";
import type { Channel } from "../models/channel.js";
import {
  nodeChannelName,
  globalChannelName,
  edgeChannelName,
  isNodeChannel,
  isGlobalChannel,
  GLOBAL_CHANNEL_PREFIX,
} from "../models/channel.js";
import type { Task, TaskStatus } from "../models/task.js";
import { createTask, taskId, isTerminalStatus, TERMINAL_STATUSES } from "../models/task.js";
import type {
  WorkflowRecord,
  WorkflowState,
  SuperstepStatus,
  RunInfo,
} from "../models/superstep.js";
import type { Edge } from "../models/graph.js";
import { getWorkflowFile } from "../constants.js";
import { ensureDir } from "../utils/file.js";
import { computeTopologicalLayers } from "../utils/topology.js";
import { appendEvent } from "./event-service.js";
import { resolveCurrentRunId } from "./run-service.js";

// ===== Run ID 解析 =====

async function resolveRun(runId?: string): Promise<string> {
  if (runId) return runId;
  return resolveCurrentRunId();
}

// ===== JSONL 读写 =====

async function readRecords(runId: string): Promise<WorkflowRecord[]> {
  const filePath = getWorkflowFile(runId);
  try {
    const content = await fs.readFile(path.resolve(filePath), "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((line: string) => line.length > 0)
      .map((line: string) => JSON.parse(line) as WorkflowRecord);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function appendRecord(
  record: WorkflowRecord,
  runId: string
): Promise<void> {
  const filePath = getWorkflowFile(runId);
  await ensureDir(path.dirname(path.resolve(filePath)));
  const line = JSON.stringify(record) + "\n";
  await fs.appendFile(path.resolve(filePath), line, "utf-8");
}

// ===== 状态加载 =====

export async function loadState(runId?: string): Promise<WorkflowState> {
  const rid = await resolveRun(runId);
  const records = await readRecords(rid);
  if (records.length === 0) {
    throw new Error("工作流尚未初始化");
  }

  const channels: Record<string, Channel> = {};
  for (const record of records) {
    Object.assign(channels, record.channelChanges);
  }

  return {
    channels,
    currentRecord: records[records.length - 1],
  };
}

// ===== Channel 操作 =====

export async function getChannel(
  name: string,
  runId?: string
): Promise<Channel | null> {
  const state = await loadState(runId);
  return state.channels[name] ?? null;
}

export async function getChannelVersion(
  name: string,
  runId?: string
): Promise<number> {
  const ch = await getChannel(name, runId);
  return ch?.version ?? 0;
}

export async function listChannels(
  nodeName?: string,
  runId?: string
): Promise<Channel[]> {
  const state = await loadState(runId);
  const all = Object.values(state.channels);
  if (!nodeName) return all;

  if (nodeName === GLOBAL_CHANNEL_PREFIX) {
    return all.filter((ch) => isGlobalChannel(ch.name));
  }
  return all.filter((ch) => isNodeChannel(ch.name, nodeName));
}

export async function setChannel(
  name: string,
  value: unknown,
  runId?: string
): Promise<Channel> {
  const rid = await resolveRun(runId);
  const state = await loadState(rid);
  const existing = state.channels[name];
  const now = new Date().toISOString();

  const channel: Channel = {
    name,
    value,
    version: (existing?.version ?? 0) + 1,
    updatedAt: now,
  };

  // 更新当前 record 的 channelChanges 并追加
  const record: WorkflowRecord = {
    ...state.currentRecord,
    channelChanges: {
      ...state.currentRecord.channelChanges,
      [name]: channel,
    },
  };

  await appendRecord(record, rid);
  return channel;
}

export async function clearChannels(
  nodeName: string,
  runId?: string
): Promise<void> {
  const rid = await resolveRun(runId);
  const state = await loadState(rid);
  const now = new Date().toISOString();

  const changes: Record<string, Channel> = {};
  for (const [name, ch] of Object.entries(state.channels)) {
    if (isNodeChannel(name, nodeName)) {
      changes[name] = { name, value: null, version: ch.version + 1, updatedAt: now };
    }
  }

  if (Object.keys(changes).length === 0) return;

  const record: WorkflowRecord = {
    ...state.currentRecord,
    channelChanges: { ...state.currentRecord.channelChanges, ...changes },
  };

  await appendRecord(record, rid);
}

export async function getGlobalChannel(
  key: string,
  runId?: string
): Promise<Channel | null> {
  return getChannel(globalChannelName(key), runId);
}

export async function setGlobalChannel(
  key: string,
  value: unknown,
  runId?: string
): Promise<Channel> {
  return setChannel(globalChannelName(key), value, runId);
}

// ===== Edge Channel 初始化 =====

export async function initEdgeChannels(
  edges: Edge[],
  runId: string
): Promise<void> {
  const now = new Date().toISOString();
  const changes: Record<string, Channel> = {};

  for (const edge of edges) {
    const name = edgeChannelName(edge.to, edge.from);
    if (!changes[name]) {
      changes[name] = { name, value: null, version: 0, updatedAt: now };
    }
  }

  // 边 channels 在第一条 record 初始化时写入
  const records = await readRecords(runId);
  if (records.length > 0) {
    records[0].channelChanges = { ...records[0].channelChanges, ...changes };
    // 重写整个文件
    const filePath = getWorkflowFile(runId);
    const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await fs.writeFile(path.resolve(filePath), content, "utf-8");
  }
}

function updateEdgeChannelsForNode(
  nodeId: string,
  taskStatus: string,
  edges: Edge[],
  existingChannels: Record<string, Channel>
): Record<string, Channel> {
  const now = new Date().toISOString();
  const changes: Record<string, Channel> = {};

  for (const edge of edges) {
    if (edge.to === nodeId) {
      const name = edgeChannelName(edge.to, edge.from);
      const existing = existingChannels[name];
      changes[name] = {
        name,
        value: taskStatus,
        version: (existing?.version ?? 0) + 1,
        updatedAt: now,
      };
    }
  }

  return changes;
}

// ===== Task 生命周期 =====

export async function startTask(
  nodeId: string,
  runId?: string
): Promise<Task> {
  const rid = await resolveRun(runId);
  const state = await loadState(rid);
  const task = findTaskInRecord(state.currentRecord, nodeId);

  if (!task) {
    throw new Error(`节点 '${nodeId}' 不在当前 superstep 中`);
  }
  if (task.status !== "ready") {
    throw new Error(`任务 '${nodeId}' 当前状态为 '${task.status}'，无法启动（需要 'ready'）`);
  }

  const now = new Date().toISOString();
  task.status = "running";
  task.startedAt = now;

  const record: WorkflowRecord = {
    ...state.currentRecord,
    status: "running" as SuperstepStatus,
  };

  await appendRecord(record, rid);
  await appendEvent(nodeId, "ready", "running", rid);
  return task;
}

export async function completeTask(
  nodeId: string,
  edges: Edge[],
  runId?: string
): Promise<{ task: Task; advanced: boolean }> {
  const rid = await resolveRun(runId);
  const state = await loadState(rid);
  const task = findTaskInRecord(state.currentRecord, nodeId);

  if (!task) {
    throw new Error(`节点 '${nodeId}' 不在当前 superstep 中`);
  }
  if (task.status !== "running") {
    throw new Error(`任务 '${nodeId}' 当前状态为 '${task.status}'，无法完成（需要 'running'）`);
  }

  const now = new Date().toISOString();
  task.status = "success";
  task.completedAt = now;

  // 更新 edge channels
  const edgeChanges = updateEdgeChannelsForNode(
    nodeId,
    "success",
    edges,
    state.channels
  );

  // 检查 superstep 是否完成
  const allTerminal = state.currentRecord.tasks.every((t) =>
    isTerminalStatus(t.status)
  );

  let advanced = false;

  if (allTerminal) {
    // Superstep 完成：收集所有 channelChanges，执行快照
    const record: WorkflowRecord = {
      ...state.currentRecord,
      status: "completed" as SuperstepStatus,
      completedAt: now,
      channelChanges: { ...state.currentRecord.channelChanges, ...edgeChanges },
    };

    await appendRecord(record, rid);
    await appendEvent(nodeId, "running", "success", rid);

    // 自动推进到下一层
    advanced = await tryAdvanceStep(rid);
  } else {
    // 还有未完成的 task
    const record: WorkflowRecord = {
      ...state.currentRecord,
      channelChanges: { ...state.currentRecord.channelChanges, ...edgeChanges },
    };

    await appendRecord(record, rid);
    await appendEvent(nodeId, "running", "success", rid);
  }

  return { task, advanced };
}

export async function failTask(
  nodeId: string,
  error?: string,
  runId?: string
): Promise<Task> {
  const rid = await resolveRun(runId);
  const state = await loadState(rid);
  const task = findTaskInRecord(state.currentRecord, nodeId);

  if (!task) {
    throw new Error(`节点 '${nodeId}' 不在当前 superstep 中`);
  }
  if (task.status !== "running") {
    throw new Error(`任务 '${nodeId}' 当前状态为 '${task.status}'，无法标记失败（需要 'running'）`);
  }

  const now = new Date().toISOString();
  task.status = "failed";
  task.completedAt = now;
  task.error = error;

  const record: WorkflowRecord = {
    ...state.currentRecord,
    status: "failed" as SuperstepStatus,
  };

  await appendRecord(record, rid);
  await appendEvent(nodeId, "running", "failed", rid);
  return task;
}

export async function skipTask(
  nodeId: string,
  edges: Edge[],
  runId?: string
): Promise<{ task: Task; advanced: boolean }> {
  const rid = await resolveRun(runId);
  const state = await loadState(rid);
  const task = findTaskInRecord(state.currentRecord, nodeId);

  if (!task) {
    throw new Error(`节点 '${nodeId}' 不在当前 superstep 中`);
  }
  if (task.status !== "ready" && task.status !== "running") {
    throw new Error(`任务 '${nodeId}' 当前状态为 '${task.status}'，无法跳过`);
  }

  const fromStatus = task.status;
  const now = new Date().toISOString();
  task.status = "skipped";
  task.completedAt = now;

  // 更新 edge channels
  const edgeChanges = updateEdgeChannelsForNode(
    nodeId,
    "skipped",
    edges,
    state.channels
  );

  const allTerminal = state.currentRecord.tasks.every((t) =>
    isTerminalStatus(t.status)
  );

  let advanced = false;

  if (allTerminal) {
    const hasFailed = state.currentRecord.tasks.some((t) => t.status === "failed");
    if (!hasFailed) {
      const record: WorkflowRecord = {
        ...state.currentRecord,
        status: "completed" as SuperstepStatus,
        completedAt: now,
        channelChanges: { ...state.currentRecord.channelChanges, ...edgeChanges },
      };
      await appendRecord(record, rid);
      await appendEvent(nodeId, fromStatus, "skipped", rid);
      advanced = await tryAdvanceStep(rid);
    } else {
      // 仍有 failed task，保持暂停
      const record: WorkflowRecord = {
        ...state.currentRecord,
        channelChanges: { ...state.currentRecord.channelChanges, ...edgeChanges },
      };
      await appendRecord(record, rid);
      await appendEvent(nodeId, fromStatus, "skipped", rid);
    }
  } else {
    const record: WorkflowRecord = {
      ...state.currentRecord,
      channelChanges: { ...state.currentRecord.channelChanges, ...edgeChanges },
    };
    await appendRecord(record, rid);
    await appendEvent(nodeId, fromStatus, "skipped", rid);
  }

  return { task, advanced };
}

export async function retryTask(
  nodeId: string,
  runId?: string
): Promise<Task> {
  const rid = await resolveRun(runId);
  const state = await loadState(rid);
  const task = findTaskInRecord(state.currentRecord, nodeId);

  if (!task) {
    throw new Error(`节点 '${nodeId}' 不在当前 superstep 中`);
  }
  if (task.status !== "failed") {
    throw new Error(`任务 '${nodeId}' 当前状态为 '${task.status}'，无法重试（需要 'failed'）`);
  }

  const now = new Date().toISOString();

  // 清除该 task 的 output channels
  const changes: Record<string, Channel> = {};
  for (const [name, ch] of Object.entries(state.channels)) {
    if (isNodeChannel(name, nodeId)) {
      changes[name] = { name, value: null, version: ch.version + 1, updatedAt: now };
    }
  }

  task.status = "ready";
  task.startedAt = undefined;
  task.completedAt = undefined;
  task.error = undefined;

  const record: WorkflowRecord = {
    ...state.currentRecord,
    status: "running" as SuperstepStatus,
    channelChanges: { ...state.currentRecord.channelChanges, ...changes },
  };

  await appendRecord(record, rid);
  await appendEvent(nodeId, "failed", "ready", rid);
  return task;
}

export async function getTask(
  nodeId: string,
  step?: number,
  runId?: string
): Promise<Task | null> {
  const rid = await resolveRun(runId);
  const records = await readRecords(rid);
  if (records.length === 0) return null;

  // 查找最新记录
  let record: WorkflowRecord;
  if (step !== undefined) {
    record = records.find((r) => r.step === step) ?? records[records.length - 1];
  } else {
    record = records[records.length - 1];
  }

  return record.tasks.find((t) => t.nodeId === nodeId) ?? null;
}

export async function listTasks(
  step?: number,
  runId?: string
): Promise<Task[]> {
  const rid = await resolveRun(runId);
  const records = await readRecords(rid);
  if (records.length === 0) return [];

  if (step !== undefined) {
    const record = records.find((r) => r.step === step);
    return record?.tasks ?? [];
  }

  return records[records.length - 1].tasks;
}

export async function findReadyTasks(runId?: string): Promise<Task[]> {
  const state = await loadState(runId);
  if (state.currentRecord.status === "failed") return [];
  return state.currentRecord.tasks.filter((t) => t.status === "ready");
}

// ===== Superstep 控制 =====

function findTaskInRecord(
  record: WorkflowRecord,
  nodeId: string
): Task | undefined {
  return record.tasks.find((t) => t.nodeId === nodeId);
}

export { computeTopologicalLayers };

export async function initWorkflow(
  runId: string,
  layers: Map<number, string[]>,
  edges: Edge[]
): Promise<void> {
  const now = new Date().toISOString();

  // 初始化 edge channels
  const edgeChanges: Record<string, Channel> = {};
  for (const edge of edges) {
    const name = edgeChannelName(edge.to, edge.from);
    if (!edgeChanges[name]) {
      edgeChanges[name] = { name, value: null, version: 0, updatedAt: now };
    }
  }

  // 创建 Layer 0 的 tasks
  const layer0Nodes = layers.get(0) ?? [];
  const tasks = layer0Nodes.map((nodeId) => createTask(nodeId, 0));

  const record: WorkflowRecord = {
    step: 0,
    status: tasks.length > 0 ? "running" : "completed",
    tasks,
    channelChanges: edgeChanges,
    startedAt: now,
  };

  await appendRecord(record, runId);
}

async function tryAdvanceStep(runId: string): Promise<boolean> {
  const { readJSON, writeJSON } = await import("../utils/file.js");
  const { getRunMetaFile } = await import("../constants.js");
  const runInfo: RunInfo = await readJSON(getRunMetaFile(runId));

  if (!runInfo.layerAssignment) return false;

  const currentStep = runInfo.currentStep;
  const nextStep = currentStep + 1;

  // 查找下一层的节点
  const nextLayerNodes: string[] = [];
  for (const [node, layer] of Object.entries(runInfo.layerAssignment)) {
    if (layer === nextStep) {
      nextLayerNodes.push(node);
    }
  }

  if (nextLayerNodes.length === 0) {
    // 工作流完成
    runInfo.status = "completed";
    runInfo.currentStep = currentStep;
    await writeJSON(getRunMetaFile(runId), runInfo);
    return false;
  }

  // 创建下一个 superstep
  const now = new Date().toISOString();
  const tasks = nextLayerNodes.map((nodeId) => createTask(nodeId, nextStep));

  const record: WorkflowRecord = {
    step: nextStep,
    status: "running",
    tasks,
    channelChanges: {},
    startedAt: now,
  };

  await appendRecord(record, runId);

  // 更新 run.json
  runInfo.currentStep = nextStep;
  runInfo.status = "running";
  await writeJSON(getRunMetaFile(runId), runInfo);

  return true;
}

export async function getCurrentStep(runId?: string): Promise<WorkflowRecord> {
  const state = await loadState(runId);
  return state.currentRecord;
}

export async function advanceStep(
  runId?: string,
  edges?: Edge[]
): Promise<WorkflowRecord | null> {
  const rid = await resolveRun(runId);
  const state = await loadState(rid);

  if (state.currentRecord.status !== "completed") {
    throw new Error(
      `当前 superstep 状态为 '${state.currentRecord.status}'，无法推进（需要 'completed'）`
    );
  }

  const advanced = await tryAdvanceStep(rid);
  if (!advanced) return null;

  const newState = await loadState(rid);
  return newState.currentRecord;
}

export async function isStepComplete(runId?: string): Promise<boolean> {
  const state = await loadState(runId);
  return state.currentRecord.status === "completed";
}

export async function isWorkflowComplete(runId?: string): Promise<boolean> {
  const state = await loadState(runId);
  return state.currentRecord.status === "completed"
    && state.currentRecord.tasks.every((t) => t.status === "success" || t.status === "skipped");
}

export async function getStepHistory(runId?: string): Promise<WorkflowRecord[]> {
  const rid = await resolveRun(runId);
  return readRecords(rid);
}
