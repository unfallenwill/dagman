export const TASK_STATUSES = [
  "ready",
  "running",
  "success",
  "failed",
  "skipped",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_STATUSES: readonly TaskStatus[] = [
  "success",
  "failed",
  "skipped",
];

export interface Task {
  id: string;
  nodeId: string;
  step: number;
  status: TaskStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/** Generate a Task ID */
export function taskId(nodeId: string, step: number): string {
  return `${nodeId}@step${step}`;
}

/** Check whether a task is in a terminal status */
export function isTerminalStatus(status: TaskStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** Create an initial Task */
export function createTask(nodeId: string, step: number): Task {
  return {
    id: taskId(nodeId, step),
    nodeId,
    step,
    status: "ready",
  };
}
