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

### 1. Write a plan file

Create a YAML file with `---` separators. Nodes (`kind: Node`) define "what to do", graphs (`kind: Graph`) define "how they connect":

```yaml
kind: Node
name: setup
description: Initialize project environment
instructions: Install dependencies and create config files
---
kind: Node
name: lint
description: Code check
instructions: Run ESLint on all source files
---
kind: Node
name: test
description: Run tests
instructions: Execute the full test suite
---
kind: Node
name: deploy
description: Deploy to production
instructions: Build and deploy to production server
---
kind: Graph
name: ci
edges:
  - from: lint
    to: setup
  - from: test
    to: setup
  - from: deploy
    to: lint
  - from: deploy
    to: test
```

### 2. Import nodes and graph

```bash
dagman import plan.yaml

# Or from stdin
cat plan.yaml | dagman import
```

### 3. Create a run

```bash
dagman run create my-deploy --graph ci --switch
```

### 4. Drive execution

```bash
# Get the next executable task
dagman next

# Start the task
dagman task start setup

# After executing, mark as complete
dagman task complete setup

# Store output for downstream nodes (optional)
dagman channel set setup output-path /tmp/build

# Get the next task
dagman next

# ... repeat until no executable tasks
```

### 5. Export

```bash
# Export to stdout
dagman export

# Export a specific graph and its referenced nodes
dagman export --graph ci > plan.yaml

# Export to a file
dagman export plan.yaml
```

## Command Reference

### `dagman import [file]`

Import nodes and graphs from a YAML file or stdin. Supports multi-document YAML with `kind: Node` and `kind: Graph`. Skips already-existing names.

```bash
dagman import plan.yaml    # Import from file
dagman import < plan.yaml  # Import from stdin
```

### `dagman export [file]`

Export nodes and graphs as YAML. Defaults to stdout.

```bash
dagman export                    # Export all nodes and graphs
dagman export --graph ci         # Export specific graph and its nodes
dagman export > plan.yaml        # Export to stdout
dagman export plan.yaml          # Export to file
```

### `dagman node`

Node definition management.

```bash
dagman node create <name>            # Create a node
dagman node list                     # List all nodes
dagman node remove <name> [--force]  # Remove a node
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

Nodes do not contain dependency information. Dependencies are declared via edges in the graph:

```yaml
kind: Graph
name: ci
edges:
  # Shorthand: lint depends on setup, expects setup status to be success
  - from: lint
    to: setup

  # Full form: specify expected upstream status
  - from: optional-check
    to: setup
    expect: skipped
```

`expect` defaults to `"success"`. When expecting `"success"`, an upstream node with `"skipped"` status also satisfies the dependency (skipped equals success).

## Variable References

Node instructions support Handlebars templates to reference upstream outputs:

```yaml
kind: Node
name: build
description: Build the project
instructions: Build using config from {{setup.config-path}}
```

- `{{key}}` — current node's own channel
- `{{node-name.key}}` — upstream node channel (validated at import time)
- `{{global.key}}` — global channel

## Data Storage

All data is stored in `.dagman/` under the project directory:

```
.dagman/
  .current-run              # Current active run ID
  nodes/
    <name>.yaml             # Node definitions (kind: Node)
  graphs/
    <name>.yaml             # Graph definitions (kind: Graph)
  runs/
    <run-id>/
      run.json              # Run metadata (graphName, currentStep, status, layerAssignment)
      workflow.jsonl        # Workflow state (channels + tasks + snapshots, append-only)
      events.jsonl          # Task event log (append-only)
```

Node definitions are globally shared, graph definitions declare topology, and state/channels are isolated per run.

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm run dev          # Run in dev mode
npm test             # Run tests
```

## License

MIT
