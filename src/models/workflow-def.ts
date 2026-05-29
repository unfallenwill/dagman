import type { Edge } from "./graph.js";

/** Node definition produced by the builder (compile-time) */
export interface NodeDef {
  name: string;
  /** Execution function — not serialized, runtime tsx import */
  fn: (state: any) => void;
  /** StateGraph key — if set, auto-generates a collect task */
  stateKey?: string;
}

/** Conditional edge = virtual routing node */
export interface CondEdgeDef {
  /** Compiled virtual node name, e.g. 'cond:classify→route' */
  nodeName: string;
  /** Upstream node name */
  from: string;
  /** Candidate downstream nodes */
  targets: string[];
  /** Evaluation function — not serialized, runtime tsx import */
  fn: (state: any) => string;
}

/** Fan-out = dynamic parallel task generation */
export interface FanOutDef {
  /** Compiled virtual node name, e.g. 'fanout:classify→processItems' */
  nodeName: string;
  /** Upstream node name that triggers the fan-out */
  from: string;
  /** Template node to be instantiated for each item */
  templateNode: string;
  /** Evaluation function — returns array of items to fan out */
  fn: (state: any) => any[];
}

/** Compiled workflow definition (output of builder.build()) */
export interface WorkflowDefinition {
  name: string;
  /** Zod schema serialized to JSON Schema */
  stateSchema: Record<string, unknown>;
  nodes: NodeDef[];
  edges: Edge[];
  condEdges: CondEdgeDef[];
  fanOuts: FanOutDef[];
  /** Nodes connected from START (entry points) */
  entryNodes?: string[];
  /** Nodes connected to END (exit points) */
  exitNodes?: string[];
}

/** manifest.yaml format */
export interface WorkflowManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  repository?: string;
  license?: string;
}
