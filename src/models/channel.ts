export interface Channel {
  name: string
  value: unknown
  version: number
  updatedAt: string
}

/** Node name prefix for global context channels */
export const GLOBAL_CHANNEL_PREFIX = '_global'

/** Naming prefix for edge channels */
export const EDGE_CHANNEL_PREFIX = 'edge:'

/** Naming prefix for StateGraph channels */
export const STATE_CHANNEL_PREFIX = '_state'

/** Naming prefix for condEdge channels */
export const COND_CHANNEL_PREFIX = '_cond'

/** Build a node context channel name */
export function nodeChannelName(nodeName: string, key: string): string {
  return `${nodeName}.${key}`
}

/** Build a global channel name */
export function globalChannelName(key: string): string {
  return `${GLOBAL_CHANNEL_PREFIX}.${key}`
}

/** Build an edge channel name (from→to semantics: from is depended on by to) */
export function edgeChannelName(from: string, to: string): string {
  return `${EDGE_CHANNEL_PREFIX}${from}→${to}`
}

/** Check whether a channel name belongs to the specified node */
export function isNodeChannel(name: string, nodeName: string): boolean {
  return name.startsWith(`${nodeName}.`)
}

/** Check whether a channel name is a global channel */
export function isGlobalChannel(name: string): boolean {
  return name.startsWith(`${GLOBAL_CHANNEL_PREFIX}.`)
}

/** Check whether a channel name is an edge channel */
export function isEdgeChannel(name: string): boolean {
  return name.startsWith(EDGE_CHANNEL_PREFIX)
}

/** Build a StateGraph channel name */
export function stateChannelName(key: string): string {
  return `${STATE_CHANNEL_PREFIX}.${key}`
}

/** Check whether a channel name is a StateGraph channel */
export function isStateChannel(name: string): boolean {
  return name.startsWith(STATE_CHANNEL_PREFIX + '.')
}

/** Build a condEdge channel name */
export function condChannelName(condNodeName: string): string {
  return `${COND_CHANNEL_PREFIX}.${condNodeName}`
}

/** Check whether a channel name is a condEdge channel */
export function isCondChannel(name: string): boolean {
  return name.startsWith(COND_CHANNEL_PREFIX + '.')
}

/** Naming prefix for fan-out channels */
export const FANOUT_CHANNEL_PREFIX = '_fanout'

/** Build a fan-out channel name */
export function fanoutChannelName(fanOutNodeName: string): string {
  return `${FANOUT_CHANNEL_PREFIX}.${fanOutNodeName}`
}

/** Check whether a channel name is a fan-out channel */
export function isFanoutChannel(name: string): boolean {
  return name.startsWith(FANOUT_CHANNEL_PREFIX + '.')
}
