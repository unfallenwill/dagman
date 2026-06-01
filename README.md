# dagman

A DAG-based agent task orchestration CLI. dagman splits complex multi-step tasks into a DAG of nodes. `dagman next` executes node functions in-process, one topological layer at a time.

## Install

```bash
npm install -g dagman
```

Requires Node.js ≥ 18.

## Quick Start

### 1. Write a workflow

```bash
mkdir -p .dagman/workflows/text-transform
```

Create `.dagman/workflows/text-transform/index.ts`:

```typescript
import { node, workflow, START, END } from 'dagman/api'

export default workflow('text-transform', {
  state: { text: 'hello', result: '' },
  version: '1.0.0',
  description: 'Uppercase and reverse a text value',
})
  .add('upper', node((state) => ({ text: String(state.text).toUpperCase() })))
  .add('reverse', node((state) => ({ result: String(state.text).split('').reverse().join('') })))
  .edge(START, 'upper')
  .edge('upper', 'reverse')
  .edge('reverse', END)
  .build()
```

### 2. Start and run

```bash
$ dagman ls                       # List discovered workflows
  [local] text-transform v1.0.0 - Uppercase and reverse a text value

$ dagman start text-transform     # Compile and create a run instance
text-transform@1a2b3c4d

$ dagman next                     # Execute the next superstep

Name:       text-transform
Version:    1.0.0
Description:Uppercase and reverse a text value

Step 1/2: 1 node(s) executed
  ✓ upper → success

State:
  text: "HELLO"
  result: ""

Run status: running (step 1/2)

$ dagman next                     # Execute the next step

Name:       text-transform
Version:    1.0.0
Description:Uppercase and reverse a text value

Step 2/2: 1 node(s) executed
  ✓ reverse → success

State:
  text: "HELLO"
  result: "OLLEH"

Run status: completed (step 2/2)
```

## Why dagman?

Unlike LangGraph or CrewAI which embed the agent loop, dagman is agent-agnostic — it works with any agent framework or manual CLI usage. Unlike Temporal or BullMQ which require a server, dagman is file-based with zero infrastructure.

- **AI agent loops** — wrap agent or tool calls inside node functions, then step the DAG with `dagman next`
- **Human-in-the-loop** — pause on failure, inspect state, decide how to proceed
- **File-based orchestration** — inspect runs, state, and task history without a server

The core loop is:

```
start → loop { next } → completed
```

## Multiple Run Instances

dagman supports multiple concurrent run instances. `dagman start` creates a new run and sets it as the active run. `dagman next` without `-r` operates on the active run (tracked in `.dagman/.current-run`). Use `-r <run-id>` to target a specific instance.

```bash
$ dagman start demo               # Creates demo@a1b2c3d4, sets as active
$ dagman start demo               # Creates demo@e5f6g7h8, sets as active
$ dagman ps                       # Lists both running instances
$ dagman next -r demo@a1b2c3d4    # Execute step on the first run
```

## Command Reference

| Command | Description |
|---------|-------------|
| `dagman ls` | List discovered workflows |
| `dagman show <name>` | Show workflow metadata and graph visualization |
| `dagman start <name>` | Compile workflow and start a run instance |
| `dagman ps` | List run instances |
| `dagman next` | Execute the next superstep |
| `dagman help [subcommand]` | Show usage guide or command details |

Global option: `--workflows-dir <path>` to override workflow search directories.

### `dagman start <name>`

Compile a workflow TypeScript definition into a graph, create a run instance, and set it as the active run. Outputs the run ID (format: `<name>@<8-char-hex>`).

```bash
$ dagman start demo
demo@1a2b3c4d
```

### `dagman next`

The core execution command. Finds all triggered nodes in the current topological layer, executes their functions sequentially, and advances the step when all tasks in the layer reach a terminal state.

```bash
$ dagman next                    # Execute the next step (default)
$ dagman next --all              # Same as default behavior
$ dagman next --step             # Show current superstep status without executing
$ dagman next --json             # JSON output
$ dagman next -r demo@1a2b3c4d   # Specify run instance
```

When a task fails, the run pauses with status `paused_for_intervention`. Manual intervention is required — inspect the failure, then `dagman start` a new run to retry.

### `dagman ps`

List run instances. By default shows only running/paused runs.

```bash
$ dagman ps                      # Running instances only
$ dagman ps -a                   # All instances including completed
$ dagman ps --json               # JSON output
```

### `dagman show <name>`

Display workflow metadata (name, version, description) and an ASCII DAG graph visualization.

```bash
$ dagman show demo               # Metadata + graph
$ dagman show demo --json        # Metadata as JSON
```

## Builder API

### `node(fn)`

Define a workflow node. `fn` receives the shared state and returns a partial update (patch) that gets merged back.

```typescript
import { node } from 'dagman/api'

const upper = node((state) => ({
  text: String(state.text).toUpperCase(),
}))
```

### `workflow(name, config)`

Create a workflow builder with initial state and optional metadata.

```typescript
import { workflow, START, END } from 'dagman/api'

const def = workflow('my-workflow', {
  state: { count: 0, result: null },  // required
  version: '1.0.0',                   // optional
  description: 'Description',
  author: 'Author',
  repository: 'https://github.com/...',
  license: 'MIT',
})
  .add('stepA', node((s) => ({ count: Number(s.count) + 1 })))
  .add('stepB', node((s) => ({ result: Number(s.count) * 2 })))
  .edge(START, 'stepA')          // stepA is an entry node
  .edge('stepA', 'stepB')       // stepA executes before stepB
  .edge('stepB', END)           // stepB is an exit node
  .build()
```

### Conditional edges

Route to different nodes based on state after execution. Only one conditional edge per source node is allowed.

```typescript
import { node, workflow } from 'dagman/api'

workflow('router', { state: { type: '' } })
  .add('classify', node((s) => ({ type: detectType(s) })))
  .add('process-a', node((s) => ({ result: 'A' })))
  .add('process-b', node((s) => ({ result: 'B' })))
  .condEdge('classify', ['process-a', 'process-b'], (state) => {
    // Evaluated after classify executes, using updated state
    return state.type === 'a' ? ['process-a'] : ['process-b']
  })
  .build()
```

Only the selected conditional target writes its channel. Do not join mutually exclusive branches with a barrier node unless every declared writer can execute.

### Subgraphs

Embed a child workflow. Child nodes are prefixed with the subgraph name:

```typescript
.subgraph('child', childDef)
// Child node 'step1' becomes 'child.step1'
// .edge('setup', 'child.step1') runs parent setup before child step1
// .edge('child.done', 'aggregate') runs parent aggregate after child done
```

## Core Concepts

### Node

A static task definition — a name plus a function. Nodes carry no runtime state.

### Graph

A DAG topology. Edges declare dependencies between nodes. Compiled from a TypeScript workflow via the builder API.

### Run

An execution instance of a graph, created via `dagman start`. Each run has isolated state, tasks, and channels. The run ID format is `<name>@<8-char-hex>`.

### Task

A runtime entity created from a node during execution. Lifecycle:

```
ready → running → success
                  ↘ failed (terminal)
```

Failed tasks cannot be individually retried. To re-execute, start a new run with `dagman start`.

### Superstep

BFS-layered execution. The graph is split into topological layers. All ready tasks within a layer are eligible to execute. Tasks execute sequentially within the dagman process. When all tasks in the current layer reach a terminal state, the run advances to the next layer.

### Channel

Versioned signals for coordination between nodes:

- **Trigger channel** (`trigger:<target>`) — single-source edge. Fires when the source node completes.
- **Barrier channel** (`barrier:<target>`) — multi-source join (e.g. diamond DAG). Fires only when ALL declared source nodes have completed (countdown-latch semantics).

### Edge semantics

`.edge(from, to)` means `from` executes before `to` — `from` triggers `to`:

```typescript
.edge('setup', 'lint')   // setup must complete before lint can run
.edge('setup', 'test')   // setup must complete before test can run
.edge('lint', 'deploy')  // lint must complete before deploy
.edge('test', 'deploy')  // test must complete before deploy (barrier join)
```

## Data Storage

All data is stored in `.dagman/` under the project directory:

```
.dagman/
  .current-run                          # Active run ID
  runs/
    <run-id>/
      run.json                          # Run metadata (step, status, timestamps)
      graph.json                        # Compiled graph reference (no functions)
      state.json                        # Shared mutable state
      channels.json                     # Channel states (trigger/barrier versions)
      tasks.json                        # Task execution statuses
```

Workflow definitions are discovered from:

- `<project>/.dagman/workflows/<name>/index.ts` (local, higher priority)
- `~/.dagman/workflows/<name>/index.ts` (global)

Override with `--workflows-dir <path>`.

## Agent Integration

Node functions run in-process when `dagman next` is called:

```bash
dagman start my-workflow
dagman next    # Executes step 1
dagman next    # Executes step 2
# ... repeat until "completed"
```

For agent or tool-driven work, call the agent/tool inside a node function and return its result as a state patch.

## Development

```bash
npm install              # Install dependencies
npm run build            # Compile TypeScript
npm run dev              # Run in dev mode (tsx)
npm test                 # Run tests
npm run check            # Full quality gate (typecheck + lint + format + deps)
```

## License

MIT
