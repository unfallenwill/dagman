export interface Node {
  name: string
  description: string
  instructions: string
  /** StateGraph key this node writes to (TS-compiled nodes only) */
  stateKey?: string
  /** Node kind: user (defined by user), collect (auto-generated), cond (conditional edge), fanout (fan-out) */
  kind?: 'user' | 'collect' | 'cond' | 'fanout'
  /** For collect/cond nodes: the original node name */
  parentNodeId?: string
  /** For cond nodes: the candidate target node names */
  targets?: string[]
  /** For fanout nodes: the template node name */
  templateNode?: string
}
