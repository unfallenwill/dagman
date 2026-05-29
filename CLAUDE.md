# dagman Development Workflow

This project uses dagman to manage development tasks. The workflow is predefined — just follow the steps.

## Development Environment

- `npm run build` / `tsc` — Compile TypeScript to dist/
- `npm run dev` / `tsx bin/dagman.ts` — Run in development mode
- `npm test` / `vitest` — Run tests
- `npm run lint:deps` / `depcruise src bin` — Validate dependency architecture

## Project Structure

- `bin/dagman.ts` — CLI entry point (shebang + uncaught exception handler)
- `src/cli.ts` — Commander program registration
- `src/index.ts` — Public API exports (for programmatic use)
- `src/constants.ts` — Path constants and run-aware path resolution
- `src/commands/` — CLI command definitions (Commander.js, noun+verb grouping)
- `src/workflow/` — Pregel execution engine
  - `workflow-service.ts` — Manages Channel, Task, Superstep (workflow.jsonl)
- `src/scheduling/` — Task scheduling
  - `next-service.ts` — Superstep-aware scheduling (reads ready tasks from workflow)
- `src/runtime/` — Run lifecycle + audit
  - `run-service.ts` — Run instance management (computes topological layers on creation)
  - `event-service.ts` — Fine-grained task event logging
- `src/graph/` — Static graph/node definitions + validation
  - `graph-service.ts` — Graph definition CRUD + display
  - `node-service.ts` — Node definition CRUD
  - `validator.ts` — Graph validation
- `src/compiler/` — TypeScript workflow compilation
  - `compiler.ts` — Compiles TS workflow definitions (tsx import → expand → persist)
  - `node-gen.ts` — Expands collect/condEdge/fanOut virtual nodes
- `src/api/` — Public builder API for programmatic workflow definition
  - `node.ts` / `workflow.ts` — `node()` and `workflow()` builder functions
- `src/models/` — Type definitions and data models
  - `node.ts` — Node (pure static definition, no runtime state)
  - `graph.ts` — Graph, Edge
  - `channel.ts` — Channel (versioned state unit) + naming utilities
  - `task.ts` — Task (runtime entity, ready/running/success/failed/skipped)
  - `superstep.ts` — WorkflowRecord, RunInfo, WorkflowState
  - `event.ts` — Event (audit log entry)
- `src/utils/` — Shared utilities (file I/O, topology computation, template rendering, interactive prompts, run ID resolution)
- `tests/` — vitest tests, mirrors src directory layout, isolated with tmpdir + chdir
- `.dagman/nodes/` — Node definitions (YAML, `kind: Node`)
- `.dagman/graphs/` — Graph definitions (JSON, compiled from TypeScript workflows)
- `.dagman/workflows/` — TypeScript workflow definitions (index.ts + manifest.yaml per workflow)
- `.dagman/runs/` — Run instances (workflow.jsonl state + events.jsonl audit)

## Core Concepts

### Channel + Version

All runtime data is unified as Channels, each with `value` + `version`:
- Node context channel: `{node}.{key}` (node execution output)
- Edge channel: `edge:{from}→{to}` (dependency satisfaction signal)
- Global channel: `_global.{key}` (shared across nodes)

### Node → Task Separation

- **Node**: Pure static definition (name, description, instructions), carries no state
- **Task**: Runtime entity, created from a Node by Superstep, lifecycle: ready → running → success/failed/skipped
- Failed tasks can be reset to ready via `task retry`

### Superstep (Pregel-like)

- DAG is BFS-layered by topology, each layer is a Superstep
- All ready tasks within a layer can execute in parallel
- When all tasks in the current step reach terminal state, advance to the next layer
- If any task fails within a superstep, pause and wait for manual intervention

### workflow.jsonl

Append-only JSONL file, each line records a superstep state snapshot:
```jsonl
{"step":0,"status":"completed","tasks":[...],"channelChanges":{"edge:A→B":{"value":"success","version":1,...}},...}
{"step":1,"status":"running","tasks":[...],"channelChanges":{},...}
```
- `channelChanges` only records channels that changed in this step with their latest values
- To read full state: accumulate `channelChanges` across all lines

## Code Conventions

- All imports use `.js` extension (Node16 module resolution requirement)
- User-facing errors and messages are in English
- Custom error classes are defined in `src/errors.ts`
- Node definitions are stored as YAML (`kind: Node`), no dependency info
- Graph definitions are compiled to JSON from TypeScript workflows, edges declare dependencies
- Schema validation uses zod in `src/utils/json.ts`
- Topology computation (cycle detection, layer calculation, adjacency) is centralized in `src/utils/topology.ts`

## Architecture Dependency Rules

Enforced by `npm run lint:deps` (dependency-cruiser). The dependency flow:

```
commands/  →  workflow/, scheduling/, runtime/, graph/, compiler/
scheduling/ →  workflow/, graph/, runtime/
runtime/    →  graph/, workflow/
workflow/   →  runtime/
compiler/   →  graph/ only
graph/      →  (no upward deps — innermost domain)
all domains →  models/, utils/, constants.ts, errors.ts
```

- No circular dependencies allowed
- Commands must not import from other commands
- `graph/` is the innermost domain — no upward dependencies
- `compiler/` may only import from `graph/`, `models/`, `utils/`, `constants.ts`, `errors.ts`
- `models/` and `utils/` are foundational — no domain imports

## Commit Convention

Append the following to every git commit message:

```
Co-Authored-By: GLM 5.1 <noreply@z.ai>
```

## CLI Commands

### Nodes and Graphs (Definition Layer)
- `node create/list/remove` — Node definition management
- `graph list/show/validate` — Graph definition management

### Workflow (TypeScript Builder API)
- `workflow ls` — List discovered workflows
- `workflow show <name>` — Show workflow info
- `workflow graph <name>` — Display layered topology
- `workflow start <name>` — Compile + create run instance
- `workflow compile <name>` — Dry-run compile (validate without persisting)

### Runs and Workflow (Execution Layer)
- `run create [label] --graph <name> -s` — Create a run (auto-computes topological layers)
- `run list/switch/show` — Run instance management

### Task Lifecycle
- `task list/show/start/complete/fail/skip/retry` — Task lifecycle management
- `collect <node@id>` — Collect and validate results for a node with stateKey

### Channel Management
- `channel list/get/set/clear` — Channel read/write (version auto-increments)

### Superstep
- `step show/advance/history` — Superstep view and manual advance

### Scheduling
- `next [--all] [--step] [--json]` — Returns ready task(s) in the current superstep

### Other
- `log [node]` — Audit log

## Data Storage

```
.dagman/
  .current-run              # Current active run ID
  nodes/
    <name>.yaml             # Node definition (kind: Node, no depends_on)
  graphs/
    <name>.json             # Graph definition (compiled from TypeScript workflow)
  workflows/
    <name>/
      index.ts              # TypeScript workflow definition (builder API)
      manifest.yaml         # Workflow metadata (name, version, description)
  runs/
    <run-id>/
      run.json              # Run metadata (graphName, currentStep, status, layerAssignment)
      workflow.jsonl        # Workflow state (channels + tasks + snapshots, append-only)
      events.jsonl          # Fine-grained task event log (append-only)
```

## Edge Semantics

- `Edge { from, to, expect? }` — `from` depends on `to`, `expect` defaults to `"success"`
- `skipped` equals `success`: when `expect` is `"success"`, a `"skipped"` status on the `to` node also satisfies the dependency
- Run instances bind to a graph via `run create --graph <name>`, which auto-computes topological layers
- Workflows can also be started directly via `workflow start <name>`, which compiles and creates a run in one step
