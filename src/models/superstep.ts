import type { Task } from "./task.js";
import type { Channel } from "./channel.js";

export const SUPERSTEP_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;

export type SuperstepStatus = (typeof SUPERSTEP_STATUSES)[number];

export interface WorkflowRecord {
  step: number;
  status: SuperstepStatus;
  tasks: Task[];
  /** Only channels that changed in this step, with their latest values */
  channelChanges: Record<string, Channel>;
  startedAt?: string;
  completedAt?: string;
}

export const RUN_STATUSES = ["idle", "running", "completed", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface RunInfo {
  id: string;
  createdAt: string;
  label?: string;
  graphName?: string;
  currentStep: number;
  status: RunStatus;
  layerAssignment?: Record<string, number>;
}

export interface WorkflowState {
  channels: Record<string, Channel>;
  currentRecord: WorkflowRecord;
}
