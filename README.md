# dagman

A DAG-based agent task orchestration CLI.

dagman splits complex multi-step tasks into nodes connected by edges to form a DAG. An external agent drives execution by repeatedly calling `dagman next`. dagman does not execute tasks itself — it acts as a scheduler, telling the agent what to do next and what context is available.

## Install

```bash
npm install -g dagman
```

Or use without installing:

```bash
npx -y dagman help
```

Or build from source:

```bash
git clone <repo-url> dagman
cd dagman
npm install
npm run build
npm link
```

## Quick Start

### 1. Write a TypeScript workflow

Create `.dagman/workflows/ci/index.ts` using the builder API:

```typescript
import { node, workflow, START, END } from "dagman";

const setup = node((state: any) => {
  // Install dependencies and create config files
}, "output");

const lint = node((state: any) => {
  // Run ESLint on all source files
});

const test = node((state: any) => {
  // Execute the full test suite
});

const deploy = node((state: any) => {
  // Build and deploy to production server
});

export default workflow("ci", { state: {} })
  .add("setup", setup)
  .add("lint", lint)
  .add("test", test)
  .add("deploy", deploy)
  .edge("lint", "setup")
  .edge("test", "setup")
  .edge("deploy", "lint")
  .edge("deploy", "test")
  .build();
```

### 2. Start the workflow

```bash
dagman workflow start ci
```

This compiles the TypeScript workflow, persists the graph, and creates a run instance.

### 3. Drive execution

```bash
# Get the next executable task
dagman next

# Start the task
dagman task start setup

# After executing, mark as complete
dagman task complete setup

# Collect the result (for nodes with stateKey)
dagman collect setup@<run-id> -f result.json

# Get the next task
dagman next

# ... repeat until no executable tasks
```

## Command Reference

### `dagman workflow`

Manage TypeScript workflow definitions. Workflows are defined using the builder API in `.dagman/workflows/<name>/index.ts`.

```bash
dagman workflow ls                 # List discovered workflows
dagman workflow show <name>        # Show workflow info
dagman workflow graph <name>       # Display layered topology
dagman workflow start <name>       # Compile + create run instance
dagman workflow compile <name>     # Dry-run compile (validate without persisting)
dagman workflow ps [-a] [--json]   # List workflow instances
```

### `dagman collect`

Collect and validate results for a node that has a `stateKey`. Used by the agent to submit results after node execution.

```bash
dagman collect <node@run-id> -f result.json    # Collect from file
dagman collect <node@run-id> --value '{"key":"val"}'  # Inline value
```

### `dagman task`

Task lifecycle management. Tasks are runtime entities created from nodes during execution.

States: `ready` → `running` → `success` / `failed` / `skipped`

```bash
dagman task list [--step <n>] [-r <run-id>]   # List tasks in current superstep
dagman task show <node> [-r <run-id>]          # Show task details
dagman task start <node> [-r <run-id>]         # Start task (ready → running)
dagman task complete <node> [-r <run-id>]      # Complete task (running → success)
dagman task fail <node> [--reason <msg>]       # Mark as failed (running → failed)
dagman task skip <node> [-r <run-id>]          # Skip task (→ skipped)
dagman task retry <node> [-r <run-id>]         # Retry failed task (failed → ready)
```

### `dagman channel`

Channel management. Channels are versioned key-value stores for passing data between nodes.

```bash
dagman channel list [node] [--global] [-r <run-id>]          # List channels
dagman channel get <node> <key> [--global] [-r <run-id>]     # Get channel value
dagman channel set <node> <key> <value> [--global] [-r <id>] # Set channel (auto-increments version)
dagman channel clear <node> [-r <run-id>]                     # Clear all channels for a node
```

### `dagman step`

Superstep management. Supersteps are BFS layers — all ready tasks within a layer run in parallel.

```bash
dagman step show [-r <run-id>]      # Current superstep status
dagman step advance [-r <run-id>]   # Manually advance to next superstep
dagman step history [-r <run-id>]   # Show completed superstep history
```

### `dagman graph`

Graph visualization and validation.

```bash
dagman graph list                             # List all graphs
dagman graph show [--graph <name>] [--run <id>]  # Show graph structure
dagman graph validate [--graph <name>]        # Validate graph (missing deps, cycles, orphans)
```

### `dagman run`

Run instance management. Each run has independent state, events, and channels, bound to a graph.

```bash
dagman run create [label] --graph <name> [--switch]  # Create a run bound to a graph
dagman run list                                      # List all runs
dagman run switch <run-id>                           # Switch current run
dagman run show [run-id]                             # Show run details
```

### `dagman next`

The core scheduling command. Returns the next (or all) executable task(s) in the current superstep.

```bash
dagman next                # Get next executable task
dagman next --all          # Get all executable tasks in current superstep
dagman next --json         # JSON output
dagman next --step         # Show current superstep status
dagman next -r <run-id>    # Specify run instance
```

### `dagman log`

View task event log.

```bash
dagman log                # View all events
dagman log <node>         # View events for a specific node
dagman log --run <id>     # Specify run instance
```

## Edges and Dependencies

Nodes do not contain dependency information. Dependencies are declared via edges in the workflow definition:

```typescript
export default workflow("ci", { state: {} })
  .add("setup", node(fn))
  .add("lint", node(fn))
  .add("test", node(fn))
  // lint depends on setup
  .edge("lint", "setup")
  // test depends on setup
  .edge("test", "setup")
  .build();
```

`Edge { from, to }` means `from` depends on `to` (i.e. `to` executes first). `expect` defaults to `"success"`; when expecting `"success"`, an upstream node with `"skipped"` status also satisfies the dependency (skipped equals success).

## Variable References

Node instructions support Handlebars templates to reference upstream outputs:

```typescript
const build = node((state: any) => {
  // Access upstream output via state channels
}, "result");
```

Templates in node instructions:

- `{{key}}` — current node's own channel
- `{{node-name.key}}` — upstream node channel
- `{{global.key}}` — global channel

## Data Storage

All data is stored in `.dagman/` under the project directory:

```
.dagman/
  .current-run              # Current active run ID
  nodes/
    <name>.yaml             # Node definitions (kind: Node)
  graphs/
    <name>.json             # Graph definitions (compiled from TypeScript workflow)
  workflows/
    <name>/
      index.ts              # TypeScript workflow definition (builder API)
  runs/
    <run-id>/
      run.json              # Run metadata (graphName, currentStep, status, layerAssignment)
      workflow.jsonl        # Workflow state (channels + tasks + snapshots, append-only)
      events.jsonl          # Task event log (append-only)
```

Node definitions are globally shared, graph definitions are compiled from TypeScript workflows and declare topology, and state/channels are isolated per run.

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm run dev          # Run in dev mode
npm test             # Run tests
```

## License

MIT
