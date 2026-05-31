import type { NodeBuilderState } from './types.js'
import type { NodeFn } from '../shared/models/compiled-graph.js'

export interface NodeBuilder {
  /** @internal */
  _state: NodeBuilderState
}

/**
 * Define a workflow node.
 *
 * @param fn  Function executed by dagman when `dagman next` picks this task.
 *            Runs in the dagman process via tsx import.
 *            Receives the current state and returns a partial state update (StatePatch).
 */
export function node(fn: NodeFn): NodeBuilder {
  return {
    _state: {
      fn,
    },
  }
}
