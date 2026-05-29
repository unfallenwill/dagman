export interface Channel {
  name: string;
  value: unknown;
  version: number;
  updatedAt: string;
}

/** Node name prefix for global context channels */
export const GLOBAL_CHANNEL_PREFIX = "_global";

/** Naming prefix for edge channels */
export const EDGE_CHANNEL_PREFIX = "edge:";

/** Build a node context channel name */
export function nodeChannelName(nodeName: string, key: string): string {
  return `${nodeName}.${key}`;
}

/** Build a global channel name */
export function globalChannelName(key: string): string {
  return `${GLOBAL_CHANNEL_PREFIX}.${key}`;
}

/** Build an edge channel name (from→to semantics: from is depended on by to) */
export function edgeChannelName(from: string, to: string): string {
  return `${EDGE_CHANNEL_PREFIX}${from}→${to}`;
}

/** Check whether a channel name belongs to the specified node */
export function isNodeChannel(name: string, nodeName: string): boolean {
  return name.startsWith(`${nodeName}.`);
}

/** Check whether a channel name is a global channel */
export function isGlobalChannel(name: string): boolean {
  return name.startsWith(`${GLOBAL_CHANNEL_PREFIX}.`);
}

/** Check whether a channel name is an edge channel */
export function isEdgeChannel(name: string): boolean {
  return name.startsWith(EDGE_CHANNEL_PREFIX);
}
