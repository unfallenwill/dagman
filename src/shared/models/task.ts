export const TASK_STATUSES = ['ready', 'running', 'success', 'failed', 'skipped'] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TERMINAL_STATUSES: readonly TaskStatus[] = ['success', 'failed', 'skipped']

export type TaskKind = 'execution' | 'collect' | 'eval' | 'dynamic'

export interface Task {
  id: string
  nodeId: string
  step: number
  status: TaskStatus
  startedAt?: string
  completedAt?: string
  error?: string
  /** Task kind: execution (dagman runs fn), collect (agent collects), eval (condEdge), dynamic (fan-out) */
  kind: TaskKind
  /** For collect/eval tasks: the parent node id */
  parentNodeId?: string
  /** For dynamic tasks: index within fan-out batch */
  fanOutIndex?: number
  /** For dynamic tasks: the fan-out parameter (item from fn result) */
  fanOutParam?: unknown
}

/** Generate a Task ID */
export function taskId(nodeId: string, step: number): string {
  return `${nodeId}@step${step}`
}

/** Check whether a task is in a terminal status */
export function isTerminalStatus(status: TaskStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status)
}

/** Allowed state transitions for task lifecycle */
const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  ready: ['running', 'skipped'],
  running: ['success', 'failed'],
  success: [],
  failed: ['ready'],
  skipped: [],
}

/** Check whether a task can transition from current to target status */
export function canTransition(current: TaskStatus, target: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[current].includes(target)
}

/** Create an initial Task */
export function createTask(
  nodeId: string,
  step: number,
  kind: TaskKind = 'execution',
  parentNodeId?: string,
  fanOutIndex?: number,
  fanOutParam?: unknown,
): Task {
  return {
    id: taskId(nodeId, step),
    nodeId,
    step,
    status: 'ready',
    kind,
    parentNodeId,
    fanOutIndex,
    fanOutParam,
  }
}
