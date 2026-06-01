/**
 * Compiled graph data models — type-driven architecture.
 *
 * Core principles:
 * - Node = pure function: (state) => partial_state
 * - Explicit state schema — all node outputs validated at compile time
 * - Edge = declaration intent → Compiler derives Channel + WriteStrategy
 * - Channel types: TriggerChannel (signal), BarrierChannel (count-down)
 * - Write strategies: DirectWrite (unconditional), ConditionalWrite (route-selected)
 * - No barrier-skip — barrier waits honestly; if writers don't arrive, downstream doesn't execute
 */

// ─── State ───────────────────────────────────────────────────────────

/** State schema: key → initial value. Declared explicitly by user in workflow().state() */
export type StateSchema = Record<string, unknown>

/** Runtime state: the shared mutable object all nodes read/write */
export type State = Record<string, unknown>

/** A partial state update returned by a node function */
export type StatePatch = Record<string, unknown>

// ─── Node Function ───────────────────────────────────────────────────

/** A node's execution function: reads state, returns a partial update */
export type NodeFn = (state: State) => StatePatch

/** A routing function for conditional edges: returns selected target node IDs */
export type RouteFn = (state: State) => string[]

// ─── Channel Types ───────────────────────────────────────────────────

/** Channel type discriminator */
export type ChannelType = 'trigger' | 'barrier'

/**
 * Trigger Channel — compiled from a single-source edge.
 * signal() → version++ → immediately triggered.
 */
export interface TriggerChannel {
  readonly name: string
  readonly type: 'trigger'
  version: number
}

/**
 * Barrier Channel — compiled from a join (multiple sources → same target).
 * CountDownLatch semantics: only triggers when ALL declared writers have written.
 */
export interface BarrierChannel {
  readonly name: string
  readonly type: 'barrier'
  /** Compile-time: which nodes will write to this barrier */
  readonly writers: string[]
  /** Runtime: which writers have written so far */
  received: string[]
  version: number
}

/** Union type for any channel */
export type Channel = TriggerChannel | BarrierChannel

/** Channel definition in compiled graph (template for initialization) */
export interface ChannelDef {
  readonly name: string
  readonly type: ChannelType
  readonly writers?: string[] // only for barrier channels
}

// ─── Edge Types (Builder API input, not part of compiled output) ─────

/**
 * A plain edge: from → to (sequential dependency).
 * Compiles to a TriggerChannel or contributes to a BarrierChannel.
 */
export interface PlainEdge {
  readonly from: string
  readonly to: string
}

/**
 * A conditional edge: from routes to exactly one of targets based on state.
 * Compiles to ConditionalWrite strategies on the source node.
 */
export interface ConditionalEdge {
  readonly from: string
  readonly targets: string[]
  readonly fn: RouteFn
}

/** Union of all edge types — compiler input */
export type Edge = PlainEdge | ConditionalEdge

// ─── Channel Write Strategy ──────────────────────────────────────────

/**
 * DirectWrite: unconditionally write to the bound channel after node execution.
 * Compile-time bound — the strategy doesn't decide WHETHER to write.
 */
export interface DirectWrite {
  readonly type: 'direct'
  readonly channel: string
}

/**
 * ConditionalWrite: write to the bound channel only if the route selects the target.
 * Compile-time bound to a specific channel — runtime only decides WHETHER to write.
 */
export interface ConditionalWrite {
  readonly type: 'conditional'
  readonly channel: string
  /** Which target node this strategy refers to (for route evaluation) */
  readonly target: string
}

/** Union of write strategies — replaces old HeldChannelRole */
export type ChannelWriteStrategy = DirectWrite | ConditionalWrite

// ─── Compiled Node ───────────────────────────────────────────────────

/** A node in the compiled graph — knows its communication paths */
export interface CompiledNode {
  readonly id: string

  /** The node's execution function */
  fn: NodeFn

  /**
   * Write strategies for this node.
   * Determined at compile time from edges.
   * Executed after node function completes successfully.
   */
  readonly strategies: ChannelWriteStrategy[]

  /**
   * The channel that triggers this node's execution.
   * When this channel's version > 0, this node becomes ready.
   */
  readonly triggeredBy: string

  /**
   * Routing function for conditional edges.
   * Only present on nodes that are the source of conditional edges.
   * Returns the list of selected target node IDs.
   */
  route?: RouteFn

  /**
   * For conditional edges: which targets this node can route to.
   * Used to determine which write strategies to activate.
   */
  readonly routeTargets?: string[]
}

// ─── Task ────────────────────────────────────────────────────────────

export const TASK_STATUSES = ['ready', 'running', 'success', 'failed'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TERMINAL_STATUSES: readonly TaskStatus[] = ['success', 'failed']

/** A runtime task — created when a node's trigger channel fires */
export interface Task {
  readonly id: string
  readonly nodeId: string
  readonly step: number
  status: TaskStatus
  startedAt?: string
  completedAt?: string
  error?: string
}

/** Generate a task ID */
export function taskId(nodeId: string, step: number): string {
  return `${nodeId}@step${step}`
}

/** Check whether a task is in a terminal status */
export function isTerminalStatus(status: TaskStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status)
}

/** Allowed state transitions */
const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  ready: ['running'],
  running: ['success', 'failed'],
  success: [],
  failed: ['ready'], // retry
}

/** Check whether a task can transition */
export function canTransition(current: TaskStatus, target: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[current].includes(target)
}

/** Create an initial task */
export function createTask(nodeId: string, step: number): Task {
  return {
    id: taskId(nodeId, step),
    nodeId,
    step,
    status: 'ready',
  }
}

// ─── Run ─────────────────────────────────────────────────────────────

export const RUN_STATUSES = [
  'idle',
  'running',
  'completed',
  'failed',
  'paused_for_intervention',
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/** Run metadata */
export interface RunInfo {
  readonly id: string
  readonly createdAt: string
  readonly label?: string
  readonly graphName?: string
  currentStep: number
  currentStepScheduled: boolean
  status: RunStatus
}

// ─── Compiled Graph (top-level) ──────────────────────────────────────

/**
 * The complete output of the compiler.
 * Contains everything the runtime needs to execute — no dynamic resolution required.
 */
export interface CompiledGraph {
  /** Graph name */
  readonly name: string

  /** All compiled nodes, keyed by ID */
  readonly nodes: Record<string, CompiledNode>

  /** Explicit state schema: key → initial value */
  readonly stateSchema: StateSchema

  /** All pre-allocated channels, keyed by name */
  readonly channels: Record<string, ChannelDef>

  /** Topological layers: layer[0] = entry nodes, layer[N] = exit nodes */
  readonly layers: string[][]
}

// ─── Builder Definition (input to compiler) ──────────────────────────

/** Node definition from the builder API */
export interface NodeDef {
  readonly name: string
  readonly fn: NodeFn
}

/** Workflow definition produced by the builder, input to the compiler */
export interface WorkflowDefinition {
  readonly name: string
  readonly stateSchema: StateSchema
  readonly nodes: NodeDef[]
  readonly edges: Edge[]
  /** Workflow metadata */
  readonly version?: string
  readonly description?: string
  readonly author?: string
  readonly repository?: string
  readonly license?: string
}

// ─── Type Guards ─────────────────────────────────────────────────────

/** Narrow Edge to PlainEdge */
export function isPlainEdge(edge: Edge): edge is PlainEdge {
  return 'to' in edge
}

/** Narrow Edge to ConditionalEdge */
export function isConditionalEdge(edge: Edge): edge is ConditionalEdge {
  return 'targets' in edge
}
