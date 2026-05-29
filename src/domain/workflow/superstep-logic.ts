import type { Task } from '../../shared/models/task.js'
import type { Channel } from '../../shared/models/channel.js'
import type { SuperstepStatus } from '../../shared/models/superstep.js'
import { isTerminalStatus, createTask } from '../../shared/models/task.js'
import { FANOUT_CHANNEL_PREFIX } from '../../shared/models/channel.js'

/**
 * Check if all tasks in a superstep have reached terminal status.
 * Terminal statuses are: 'success', 'failed', 'skipped'.
 *
 * @param tasks - Array of tasks in the current superstep
 * @returns true if all tasks are terminal, false otherwise
 */
export function isStepTerminal(tasks: Task[]): boolean {
  return tasks.every((t) => isTerminalStatus(t.status))
}

/**
 * Check if the entire workflow is complete.
 * A workflow is complete when:
 * - The superstep status is 'completed'
 * - All tasks are either 'success' or 'skipped' (no 'failed' tasks)
 *
 * @param status - The current superstep status
 * @param tasks - Array of tasks in the current superstep
 * @returns true if workflow is complete, false otherwise
 */
export function isWorkflowComplete(status: SuperstepStatus, tasks: Task[]): boolean {
  return (
    status === 'completed' && tasks.every((t) => t.status === 'success' || t.status === 'skipped')
  )
}

/**
 * Get fanout items for a node by scanning channels for fanout channels.
 * Fanout channels are named `_fanout.<from>→<templateNode>` and contain
 * an array of items that should each spawn a dynamic task.
 *
 * @param nodeId - The node ID to check for fanout items
 * @param channels - Current channel map
 * @returns Array of fanout items if this node is a fanout template, null otherwise
 */
export function getFanoutItemsForNode(
  nodeId: string,
  channels: Record<string, Channel>,
): unknown[] | null {
  // Look through all channels for fanout channels that target this node
  for (const [name, ch] of Object.entries(channels)) {
    if (!name.startsWith(`${FANOUT_CHANNEL_PREFIX}.`)) continue
    // The fanout channel name encodes the template: fanout:<from>→<templateNode>
    const fanoutNodeName = name.slice(`${FANOUT_CHANNEL_PREFIX}.`.length)
    // Check if the templateNode part matches nodeId
    const arrowIndex = fanoutNodeName.indexOf('→')
    if (arrowIndex === -1) continue
    const templateNode = fanoutNodeName.slice(arrowIndex + '→'.length)
    if (templateNode === nodeId && Array.isArray(ch.value)) {
      return ch.value as unknown[]
    }
  }
  return null
}

/**
 * Create tasks for a layer of nodes, expanding fanout template nodes into dynamic tasks.
 * For each node in the layer:
 * - If the node has fanout items (from upstream fanout channels), create one dynamic task per item
 * - Otherwise, create a single normal task
 *
 * @param layerNodes - Array of node IDs in this layer
 * @param step - The superstep number
 * @param channels - Current channel map (for reading fanout items)
 * @param timestamp - ISO timestamp for task creation
 * @returns Array of Task objects (one per node, or multiple for fanout nodes)
 */
export function createTasksForLayer(
  layerNodes: string[],
  step: number,
  channels: Record<string, Channel>,
): Task[] {
  const tasks: Task[] = []

  for (const nodeId of layerNodes) {
    // Check if this node is a fanout template node by looking for upstream fanout channels
    const fanoutItems = getFanoutItemsForNode(nodeId, channels)

    if (fanoutItems && fanoutItems.length > 0) {
      // Dynamic task creation: one task per item
      for (let i = 0; i < fanoutItems.length; i++) {
        tasks.push({
          ...createTask(nodeId, step, 'dynamic'),
          id: `${nodeId}#${i}@step${step}`,
          fanOutIndex: i,
          fanOutParam: fanoutItems[i],
        })
      }
    } else {
      // Normal task
      tasks.push(createTask(nodeId, step))
    }
  }

  return tasks
}
