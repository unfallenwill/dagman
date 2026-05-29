# dagman Development Workflow

This project uses dagman to manage development tasks. The workflow is predefined — just follow the steps.

## Development Environment

- `npm run build` / `tsc` — Compile TypeScript to dist/
- `npm run dev` / `tsx src/index.ts` — Run in development mode
- `npm test` / `vitest` — Run tests

## Project Structure

- `src/commands/` — CLI command definitions (Commander.js, noun+verb grouping)
- `src/constants.ts` — Path constants and run-aware path resolution
- `src/services/` — Business logic layer
  - `workflow-service.ts` — Core: manages Channel, Task, Superstep (workflow.jsonl)
  - `next-service.ts` — Superstep-aware scheduling (reads ready tasks from workflow)
  - `run-service.ts` — Run instance management (computes topological layers on creation)
  - `node-service.ts` — Node definition CRUD
  - `graph-service.ts` — Graph definition CRUD + display
  - `event-service.ts` — Fine-grained task event logging
  - `import-service.ts` / `export-service.ts` — YAML import/export
  - `validator.ts` — Graph validation
- `src/models/` — Type definitions and data models
  - `node.ts` — Node (pure static definition, no runtime state)
  - `graph.ts` — Graph, Edge
  - `channel.ts` — Channel (versioned state unit) + naming utilities
  - `task.ts` — Task (runtime entity, ready/running/success/failed/skipped)
  - `superstep.ts` — WorkflowRecord, RunInfo, WorkflowState
  - `event.ts` — Event (audit log entry)
- `src/utils/` — Shared utilities (file I/O, topology computation, template rendering, interactive prompts)
- `tests/` — vitest tests, isolated with tmpdir + chdir
- `.dagman/nodes/` — Node definitions (YAML, `kind: Node`)
- `.dagman/graphs/` — Graph definitions (YAML, `kind: Graph`)
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
- Graph definitions are stored as YAML (`kind: Graph`), edges declare dependencies
- Schema validation uses zod in `src/utils/json.ts`
- Topology computation (cycle detection, layer calculation, adjacency) is centralized in `src/utils/topology.ts`
- import/export defaults to stdin/stdout, file path as argument

## Commit Convention

Append the following to every git commit message:

```
Co-Authored-By: GLM 5.1 <noreply@z.ai>
```

## CLI Commands

### Nodes and Graphs (Definition Layer)
- `node create/list/remove` — Node definition management
- `graph list/show/validate` — Graph definition management

### Runs and Workflow (Execution Layer)
- `run create [label] --graph <name> -s` — Create a run (auto-computes topological layers)
- `run list/switch/show` — Run instance management

### Task Lifecycle
- `task list/show/start/complete/fail/skip/retry` — Task lifecycle management

### Channel Management
- `channel list/get/set/clear` — Channel read/write (version auto-increments)

### Superstep
- `step show/advance/history` — Superstep view and manual advance

### Scheduling
- `next [--all] [--step] [--json]` — Returns ready task(s) in the current superstep

### Other
- `log [node]` — Audit log
- `import/export` — YAML import/export

## Data Storage

```
.dagman/
  .current-run              # Current active run ID
  nodes/
    <name>.yaml             # Node definition (kind: Node, no depends_on)
  graphs/
    <name>.yaml             # Graph definition (kind: Graph, edges list)
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
