export const GLOBAL_STATES = ['pending', 'success', 'failed', 'skipped'] as const

export type GlobalState = (typeof GLOBAL_STATES)[number]

export const CHANGEABLE_STATES: readonly GlobalState[] = ['success', 'failed', 'skipped']

export const DEFAULT_STATE: GlobalState = 'pending'

export type StateMap = Record<string, string>

export function isGlobalState(value: string): value is GlobalState {
  return (GLOBAL_STATES as readonly string[]).includes(value)
}
