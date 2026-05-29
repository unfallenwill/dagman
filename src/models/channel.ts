export interface Channel {
  name: string;
  value: unknown;
  version: number;
  updatedAt: string;
}

/** 全局上下文的节点名前缀 */
export const GLOBAL_CHANNEL_PREFIX = "_global";

/** Edge channel 的命名前缀 */
export const EDGE_CHANNEL_PREFIX = "edge:";

/** 构造节点上下文 channel 名称 */
export function nodeChannelName(nodeName: string, key: string): string {
  return `${nodeName}.${key}`;
}

/** 构造全局 channel 名称 */
export function globalChannelName(key: string): string {
  return `${GLOBAL_CHANNEL_PREFIX}.${key}`;
}

/** 构造 edge channel 名称 (from→to 语义: from 被 to 依赖) */
export function edgeChannelName(from: string, to: string): string {
  return `${EDGE_CHANNEL_PREFIX}${from}→${to}`;
}

/** 判断 channel 名是否属于指定节点 */
export function isNodeChannel(name: string, nodeName: string): boolean {
  return name.startsWith(`${nodeName}.`);
}

/** 判断 channel 名是否为全局 channel */
export function isGlobalChannel(name: string): boolean {
  return name.startsWith(`${GLOBAL_CHANNEL_PREFIX}.`);
}

/** 判断 channel 名是否为 edge channel */
export function isEdgeChannel(name: string): boolean {
  return name.startsWith(EDGE_CHANNEL_PREFIX);
}
