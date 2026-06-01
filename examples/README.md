# dagman Examples

Runnable workflow examples that demonstrate dagman's builder API features with progressive complexity.

## Quick Start

```bash
# Build the project first
npm run build

# List available examples
npm run dev -- --workflows-dir examples ls

# Start a workflow
npm run dev -- --workflows-dir examples start text-transform

# Step through execution (repeat until complete)
npm run dev -- --workflows-dir examples next
```

> **Note:** Examples import from `../../src/index.js` so they work directly from source without publishing. Published examples would use `import { ... } from 'dagman'`.

## Examples

### 1. text-transform

```
START → upper → reverse → END
```

The minimal workflow from the README Quick Start. It starts with `hello`, uppercases it to `HELLO`, then reverses it to `OLLEH`.

**Features:** Initial state, linear state transformation, README-compatible output

---

### 2. hello-world

```
START → greet → embellish → finish → END
```

The simplest possible workflow — a linear chain of three nodes that pass state forward through string concatenation.

**Features:** `START`/`END` symbols, linear chain, basic state passing

---

### 3. etl-pipeline

```
START → extract → transform → load → END
```

An Extract-Transform-Load pipeline that simulates pulling raw records, parsing them into structured data, and counting loaded results.

**Features:** State accumulation, array data, type casting from `unknown`

---

### 4. ci-pipeline

```
                 ┌→ lint  ─┐
START → setup ──┤          ├──→ deploy → END
                 └→ test  ─┘
```

A CI/CD pipeline where `setup` runs first, then `lint` and `test` execute in parallel, and `deploy` waits for both to succeed before running.

**Features:** Parallel fan-out, barrier join (3-way), precondition checks via state

**Layers:**
- Layer 0: `setup` (entry node)
- Layer 1: `lint`, `test` (parallel — both triggered by setup)
- Layer 2: `deploy` (barrier join — waits for both lint and test)

---

### 5. conditional-router

```
                           ┌→ process-json → END
START → ingest → classify ─┤→ process-csv  → END
                           └→ process-raw  → END
```

A data processing pipeline that detects the input format (JSON, CSV, or raw text) and routes to the appropriate processor using `condEdge()`.

**Features:** `condEdge()` branching, `RouteFn`, format detection

> **Note:** Each branch connects directly to `END` rather than joining at a downstream node. A barrier join after conditional branches would deadlock because only one branch executes — the barrier would never receive all writes.

---

### 6. data-enrichment

```
┌→ fetch-users  → enrich-profiles ─┐
│                                   ├→ merge-results → END
├→ fetch-orders → enrich-orders  ──┤
│                                   │
└→ fetch-events → enrich-events  ──┘
```

The most complex example — three independent parallel chains that fetch, enrich, and then merge results. The `merge-results` node uses a 3-way barrier join to wait for all enrichment steps.

**Features:** Multiple entry nodes, 3-way barrier join, state aggregation from parallel branches

**Layers:**
- Layer 0: `fetch-users`, `fetch-orders`, `fetch-events` (parallel entry)
- Layer 1: `enrich-profiles`, `enrich-orders`, `enrich-events` (parallel)
- Layer 2: `merge-results` (barrier join — waits for all three enrich nodes)

---

## Running Examples

### From source (development)

```bash
# Build the project
npm run build

# Run with --workflows-dir flag
npm run dev -- --workflows-dir examples start <name>
npm run dev -- --workflows-dir examples next    # repeat until complete
```

### Installed dagman

```bash
dagman --workflows-dir /path/to/examples start <name>
dagman --workflows-dir /path/to/examples next    # repeat until complete
```

### Copy to project

```bash
cp -r examples/hello-world .dagman/workflows/hello-world
dagman start hello-world
dagman next    # repeat until complete
```
