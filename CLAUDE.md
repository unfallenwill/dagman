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

## Project Structure (Vertical Slice Architecture)

```
src/
  engine/       CLI startup + composition root (DI defaults)
  slices/       Each command is a self-contained slice (start/, next/, show/, …)
    _shared/    CLI-only utilities (output, command-meta, format-help)
  domain/       Business logic (pure functions or DI-injected)
    workflow/   workflow-engine, channel-ops, superstep-logic, task-state-machine
    scheduling/ scheduler (findNext, findAllNext)
    compiler/   compiler, node-gen
    graph/      graph-service, validator
    run/        run-service, run-resolver
  infra/        Infrastructure (file system)
    fs/         paths, file-ops, fs-workflow-repo, fs-event-repo, fs-run-repo
    loader/     tsx-loader (deduplicated createDefaultLoader)
  shared/       Pure types and utilities (zero external deps)
    models/     10 model files (node, graph, channel, task, etc.)
    utils/      topology, clock, id, state, loader types
    errors.ts
  api/          Builder API (unchanged, imports only shared/models)
  index.ts      Public API re-exports
```

- `tests/` — Vitest tests mirroring src layout, isolated via `setBasePath` + tmpdir

## Core Concepts

### Channel + Version

Runtime coordination uses versioned channels:
- Trigger channel: `trigger:<target>` for single-source edges
- Barrier channel: `barrier:<target>` for multi-source joins
- Shared state stores node output patches

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
- Custom error classes are defined in `src/shared/errors.ts`
- Node definitions are stored as YAML (`kind: Node`), no dependency info
- Graph definitions are compiled to JSON from TypeScript workflows, edges declare dependencies
- Topology computation (cycle detection, layer calculation, adjacency) is centralized in `src/shared/utils/topology.ts`
- DI pattern: domain files accept `deps?` parameters; defaults set via `setDefault*Deps()` in `engine/default-deps.ts`

## Architecture Dependency Rules

Enforced by `npm run lint:deps` (dependency-cruiser). The dependency flow:

```
engine/    →  slices/, domain/, infra/, shared/
slices/    →  domain/, infra/, shared/  (no cross-command imports)
domain/    →  shared/ only             (infra via DI, not direct imports)
infra/     →  shared/ only
shared/    →  (no upward deps — innermost)
api/       →  shared/models/ only
```

- No circular dependencies allowed
- Slice commands must not import from other slice commands (`_shared/` is OK)
- `domain/` must not import `infra/` (use DI injection via `setDefault*Deps()`)
- `shared/` is foundational — no upward imports to any layer
- `engine/default-deps.ts` is the composition root that wires infra to domain

## Commit Convention

Append the following to every git commit message:

```
Co-Authored-By: GLM 5.1 <noreply@z.ai>
```

## Edge Semantics

- `Edge { from, to }` — `from` triggers `to` (from executes first, to depends on from)
- `skipped` equals `success`: when a node is skipped, its downstream dependencies are still satisfied
- Run instances are created via `dagman start <name>`, which compiles the workflow and creates a run in one step
- The run auto-computes topological layers from the graph definition
