import type { Channel } from '../../shared/models/channel.js'
import type { Edge } from '../../shared/models/graph.js'
import type { WorkflowRecord } from '../../shared/models/superstep.js'
import { edgeChannelName } from '../../shared/models/channel.js'

/**
 * Aggregate channel changes from all workflow records into a single channel map.
 * This accumulates channelChanges across all records, with later records overriding
 * earlier values for the same channel name.
 *
 * @param records - Array of workflow records (superstep snapshots)
 * @returns A single record mapping channel names to their latest Channel state
 */
export function aggregateChannels(records: WorkflowRecord[]): Record<string, Channel> {
  const channels: Record<string, Channel> = {}
  for (const record of records) {
    Object.assign(channels, record.channelChanges)
  }
  return channels
}

/**
 * Compute edge channel updates for a node when a task completes.
 * For each edge where `edge.to === nodeId`, create or update an edge channel
 * with the task's status as the value.
 *
 * @param nodeId - The node ID that just completed
 * @param taskStatus - The status of the completed task (e.g., 'success', 'failed', 'skipped')
 * @param edges - All edges in the graph
 * @param existingChannels - Current channel map to read existing versions from
 * @param timestamp - ISO timestamp for the update
 * @returns A map of channel name → Channel representing the updates (not the full channel map)
 */
export function computeEdgeChannelUpdates(
  nodeId: string,
  taskStatus: string,
  edges: Edge[],
  existingChannels: Record<string, Channel>,
  timestamp: string,
): Record<string, Channel> {
  const changes: Record<string, Channel> = {}

  for (const edge of edges) {
    if (edge.to === nodeId) {
      const name = edgeChannelName(edge.to, edge.from)
      const existing = existingChannels[name]
      changes[name] = {
        name,
        value: taskStatus,
        version: (existing?.version ?? 0) + 1,
        updatedAt: timestamp,
      }
    }
  }

  return changes
}
