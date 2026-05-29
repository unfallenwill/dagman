import type { NodeBuilderState } from './types.js'

export interface NodeBuilder {
  /** @internal */
  _state: NodeBuilderState
}

/**
 * Define a workflow node.
 *
 * @param fn  Function executed by dagman when `dagman next` picks this task.
 *            Runs in the dagman process via tsx import. No return value.
 * @param stateKey  StateGraph key this node produces. If set, dagman
 *                  auto-generates a collect task for this node.
 */
export function node<S = any>(fn: (state: S) => void, stateKey?: keyof S & string): NodeBuilder {
  return {
    _state: {
      fn: fn as (state: any) => void,
      stateKey,
    },
  }
}
