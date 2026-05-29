# dagman Development Workflow

DAG-based agent task orchestration CLI. Developers write TypeScript workflow definitions using the builder API, then use the CLI to compile, run, and step through task execution.

## Development Environment

- `npm run build` / `tsc` — Compile TypeScript to dist/
- `npm run dev` / `tsx bin/dagman.ts` — Run in development mode
- `npm test` / `vitest` — Run tests
- `npm run test:coverage` / `vitest run --coverage` — Run tests with coverage report
- `npm run lint` / `eslint src bin tests` — Lint with typescript-eslint
- `npm run lint:deps` / `depcruise src bin` — Validate dependency architecture
- `npm run typecheck` / `tsc --noEmit` — Type-check without emit
- `npm run format:check` — Verify Prettier formatting
- `npm run check` — Full quality gate (typecheck + lint + format + deps)

## Quality Gates

- **tsconfig**: `strict` + `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, incremental build
- **ESLint**: flat config (`eslint.config.js`), typescript-eslint + eslint-config-prettier; `any` and `!` are `warn` (not error); `no-unsafe-*` rules are off (builder API uses `any`)
- **Prettier**: single quotes, no semi, 2-space indent, 100 print width
- **Git hooks**: pre-commit runs lint-staged (eslint + prettier), pre-push runs typecheck
- **Coverage**: v8 provider, thresholds 80% stmts/funcs/lines, 75% branches (baseline ~47%)

## Project Structure

- `src/` — Source code: `commands/`, `workflow/`, `scheduling/`, `runtime/`, `graph/`, `compiler/`, `api/`, `models/`, `utils/`
- `tests/` — Vitest tests mirroring src layout, isolated via `setBasePath` + tmpdir

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

## Edge Semantics

- `Edge { from, to, expect? }` — `from` depends on `to`, `expect` defaults to `"success"`
- `skipped` equals `success`: when `expect` is `"success"`, a `"skipped"` status on the `to` node also satisfies the dependency
- Run instances are created via `dagman start <name>`, which compiles the workflow and creates a run in one step
- The run auto-computes topological layers from the graph definition
