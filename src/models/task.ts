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

/** 生成 Task ID */
export function taskId(nodeId: string, step: number): string {
  return `${nodeId}@step${step}`;
}

/** 判断 task 是否为终态 */
export function isTerminalStatus(status: TaskStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** 创建初始 Task */
export function createTask(nodeId: string, step: number): Task {
  return {
    id: taskId(nodeId, step),
    nodeId,
    step,
    status: "ready",
  };
}
