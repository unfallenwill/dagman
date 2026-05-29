import type { Task, TaskStatus } from '../shared/models/task.js'
import { canTransition } from '../shared/models/task.js'

/**
 * Check if a task can start (transition to 'running')
 */
export function canStart(task: Task): boolean {
  return canTransition(task.status, 'running')
}

/**
 * Check if a task can complete (transition to 'success')
 */
export function canComplete(task: Task): boolean {
  return canTransition(task.status, 'success')
}

/**
 * Check if a task can fail (transition to 'failed')
 */
export function canFail(task: Task): boolean {
  return canTransition(task.status, 'failed')
}

/**
 * Check if a task can be skipped (transition to 'skipped')
 */
export function canSkip(task: Task): boolean {
  return canTransition(task.status, 'skipped')
}

/**
 * Check if a task can be retried (transition back to 'ready')
 */
export function canRetry(task: Task): boolean {
  return canTransition(task.status, 'ready')
}

/**
 * Transition a task to 'running' status
 * @returns A new Task object with status='running' and startedAt set
 */
export function transitionToRunning(task: Task, timestamp: string): Task {
  return { ...task, status: 'running' as TaskStatus, startedAt: timestamp }
}

/**
 * Transition a task to 'success' status
 * @returns A new Task object with status='success' and completedAt set
 */
export function transitionToSuccess(task: Task, timestamp: string): Task {
  return { ...task, status: 'success' as TaskStatus, completedAt: timestamp }
}

/**
 * Transition a task to 'failed' status
 * @returns A new Task object with status='failed', completedAt set, and optional error message
 */
export function transitionToFailed(task: Task, timestamp: string, error?: string): Task {
  return {
    ...task,
    status: 'failed' as TaskStatus,
    completedAt: timestamp,
    error,
  }
}

/**
 * Transition a task to 'skipped' status
 * @returns A new Task object with status='skipped' and completedAt set
 */
export function transitionToSkipped(task: Task, timestamp: string): Task {
  return { ...task, status: 'skipped' as TaskStatus, completedAt: timestamp }
}

/**
 * Transition a task back to 'ready' status (for retry)
 * @returns A new Task object with status='ready', timestamps and error cleared
 */
export function transitionToReady(task: Task): Task {
  return {
    ...task,
    status: 'ready' as TaskStatus,
    startedAt: undefined,
    completedAt: undefined,
    error: undefined,
  }
}
