import { match } from 'ts-pattern'
import { pipe, groupBy, map, flatMap, unique } from 'remeda'
import type {
  ChannelDef,
  ChannelWriteStrategy,
  Edge,
  RouteFn,
} from '../../shared/models/compiled-graph.js'
import { isPlainEdge, isConditionalEdge } from '../../shared/models/compiled-graph.js'

export interface ChannelGenResult {
  channels: Record<string, ChannelDef>
  nodeStrategies: Record<string, ChannelWriteStrategy[]>
  nodeTriggeredBy: Record<string, string>
  routeTargets: Record<string, { fn: RouteFn; targets: string[] }>
}

/** Intermediate: one source entry for a target node */
interface SourceEntry {
  source: string
  conditional: boolean
}

/**
 * Core Edge -> Channel compilation logic.
 *
 * Algorithm:
 * 1. Flatten the unified Edge[] into per-target source lists.
 *    - PlainEdge A->B: target=B, source=A, conditional=false
 *    - ConditionalEdge X->[Y,Z]: target=Y, source=X, conditional=true (and same for Z)
 * 2. For targets with a single source -> TriggerChannel
 *    - Non-conditional source -> DirectWrite
 *    - Conditional source -> ConditionalWrite
 * 3. For targets with multiple sources (join) -> BarrierChannel
 *    - ALL sources (conditional or not) -> DirectWrite to the barrier
 *    - Honest wait: if a conditional route doesn't select a writer, it won't write,
 *      the barrier won't complete, and downstream won't execute.
 */
export function generateChannels(nodeIds: string[], edges: Edge[]): ChannelGenResult {
  const channels: Record<string, ChannelDef> = {}
  const nodeStrategies: Record<string, ChannelWriteStrategy[]> = {}
  const nodeTriggeredBy: Record<string, string> = {}
  const routeTargets: Record<string, { fn: RouteFn; targets: string[] }> = {}

  // Initialize strategies for every node
  for (const nodeId of nodeIds) {
    nodeStrategies[nodeId] = []
  }

  // ── Step 1: Flatten edges into per-target source entries ──

  interface FlatEntry {
    target: string
    source: string
    conditional: boolean
  }

  const flatEntries: FlatEntry[] = pipe(
    edges,
    flatMap((edge) =>
      match(edge)
        .when(isPlainEdge, (e: { from: string; to: string }) => [
          { target: e.to, source: e.from, conditional: false },
        ])
        .when(isConditionalEdge, (e: { from: string; targets: string[]; fn: RouteFn }) => {
          // Guard: each source node may only have one conditional edge
          if (routeTargets[e.from]) {
            throw new Error(
              `node '${e.from}' has multiple conditional edges; only one is allowed per node`,
            )
          }
          routeTargets[e.from] = { fn: e.fn, targets: [...e.targets] }
          return e.targets.map((target) => ({
            target,
            source: e.from,
            conditional: true,
          }))
        })
        .exhaustive(),
    ),
  )

  // Group entries by target node
  const byTarget = groupBy(flatEntries, (e) => e.target)

  // ── Step 2 & 3: Generate channels and strategies ──

  for (const [target, entries] of Object.entries(byTarget)) {
    const sources: SourceEntry[] = entries.map((e) => ({
      source: e.source,
      conditional: e.conditional,
    }))

    if (sources.length === 1) {
      // ── Single source -> Trigger channel ──
      const channelName = `trigger:${target}`
      channels[channelName] = {
        name: channelName,
        type: 'trigger',
      }
      nodeTriggeredBy[target] = channelName

      const entry = sources[0]!
      if (entry.conditional) {
        nodeStrategies[entry.source]!.push({
          type: 'conditional',
          channel: channelName,
          target,
        })
      } else {
        nodeStrategies[entry.source]!.push({
          type: 'direct',
          channel: channelName,
        })
      }
    } else {
      // ── Multiple sources (join) -> Barrier channel ──
      const channelName = `barrier:${target}`
      const writerList: string[] = pipe(
        sources,
        map((s) => s.source),
        unique(),
      )
      channels[channelName] = {
        name: channelName,
        type: 'barrier',
        writers: writerList,
      }
      nodeTriggeredBy[target] = channelName

      // Non-conditional sources always write to the barrier (DirectWrite).
      // Conditional sources use ConditionalWrite — they only write when the route selects
      // this target. If the route doesn't select them, they don't write, the barrier waits
      // honestly, and downstream doesn't execute.
      for (const entry of sources) {
        if (entry.conditional) {
          nodeStrategies[entry.source]!.push({
            type: 'conditional',
            channel: channelName,
            target,
          })
        } else {
          nodeStrategies[entry.source]!.push({
            type: 'direct',
            channel: channelName,
          })
        }
      }
    }
  }

  return { channels, nodeStrategies, nodeTriggeredBy, routeTargets }
}
