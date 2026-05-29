import type { Command } from "commander";
import { WORKFLOWS_DIR, getWorkflowManifest } from "../constants.js";
import { compileWorkflow } from "../compiler/compiler.js";
import { expandWorkflow } from "../compiler/node-gen.js";
import { computeTopologicalLayers } from "../utils/topology.js";
import { generateInstanceId } from "../utils/id.js";
import * as runService from "../runtime/run.js";
import { graphExists } from "../graph/graph.js";
import { ValidationError } from "../errors.js";
import { withErrorHandler } from "../utils/output.js";
import { outputJson } from "../utils/output.js";
import { ensureDir, fileExists, readYAML } from "../utils/file.js";
import { promises as fs } from "fs";
import * as path from "path";

export function registerWorkflowCommand(program: Command): void {
  const workflow = program.command("workflow").summary("Manage TS workflow definitions");

  workflow
    .command("ls")
    .summary("List discovered workflows")
    .action(
      withErrorHandler(async () => {
        const workflows = await discoverWorkflows();
        if (workflows.length === 0) {
          console.log("No workflows found in " + WORKFLOWS_DIR + "/");
          return;
        }
        for (const wf of workflows) {
          console.log("  " + wf.name + " v" + wf.version + " - " + wf.description);
        }
      }),
    );

  workflow
    .command("graph <name>")
    .summary("Display layered topology of a workflow")
    .option("--json", "Output as JSON")
    .action(
      withErrorHandler(async (name: string, opts: { json?: boolean }) => {
        const result = await compileWorkflow(name);
        const layers = computeTopologicalLayers(
          result.graph.edges,
          result.nodes.map((n) => n.name)
        );

        if (opts.json) {
          outputJson({
            workflow: name,
            layers: Object.fromEntries(layers),
            nodes: result.nodes.map((n) => ({
              name: n.name,
              kind: n.kind,
              layer: (() => {
                for (const [idx, names] of layers.entries()) {
                  if (names.includes(n.name)) return idx;
                }
                return -1;
              })(),
            })),
          });
        } else {
          renderAsciiLayers(layers, result.nodes);
        }
      }),
    );

  workflow
    .command("start <name>")
    .summary("Start a workflow instance")
    .action(
      withErrorHandler(async (name: string) => {
        // Compile workflow (persists graph, which will be loaded by createRun)
        await compileWorkflow(name);

        // Create run with generated instance ID
        const runInfo = await runService.createRun(undefined, name, true);

        console.log(runInfo.id);
      }),
    );

  workflow
    .command("ps")
    .summary("List workflow instances")
    .option("-a, --all", "Show all instances (not just running)")
    .option("--json", "Output as JSON")
    .action(
      withErrorHandler(async (opts: { all?: boolean; json?: boolean }) => {
        const runs = await runService.listRuns();
        const filtered = opts.all
          ? runs
          : runs.filter((r) => r.status === "running");

        if (opts.json) {
          outputJson(
            filtered.map((r) => ({
              id: r.id,
              status: r.status,
              graphName: r.graphName,
              createdAt: r.createdAt,
            }))
          );
        } else {
          renderPsTable(filtered);
        }
      }),
    );

  workflow
    .command("show <name>")
    .summary("Show workflow information")
    .option("--json", "Output as JSON")
    .action(
      withErrorHandler(async (name: string, opts: { json?: boolean }) => {
        const manifest = await loadManifest(name);
        const compiled = await graphExists(name);

        if (opts.json) {
          outputJson({ ...manifest, compiled });
        } else {
          console.log("Name:       " + manifest.name);
          console.log("Version:    " + manifest.version);
          console.log("Description:" + manifest.description);
          if (manifest.author) console.log("Author:     " + manifest.author);
          if (manifest.repository) console.log("Repository: " + manifest.repository);
          if (manifest.license) console.log("License:    " + manifest.license);
          console.log("Compiled:   " + (compiled ? "yes" : "no"));
        }
      }),
    );

  workflow
    .command("compile <name>")
    .summary("Dry-run compile (validate without persisting)")
    .action(
      withErrorHandler(async (name: string) => {
        const result = await compileWorkflow(name);
        console.log("Compile OK: " + result.nodes.length + " nodes, " + result.graph.edges.length + " edges");
      }),
    );
}

interface DiscoveredWorkflow {
  name: string;
  version: string;
  description: string;
}

/** Scan .dagman/workflows/ subdirectories for manifest.yaml files */
async function discoverWorkflows(): Promise<DiscoveredWorkflow[]> {
  const workflows: DiscoveredWorkflow[] = [];
  const absDir = path.resolve(WORKFLOWS_DIR);

  try {
    const entries = await fs.readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = absDir + "/" + entry.name + "/manifest.yaml";
      try {
        const data = await readYAML<Record<string, unknown>>(manifestPath);
        workflows.push({
          name: (data.name as string) || entry.name,
          version: (data.version as string) || "0.0.0",
          description: (data.description as string) || "",
        });
      } catch {
        // Skip workflows without valid manifest
      }
    }
  } catch {
    // workflows dir doesn't exist
  }

  return workflows;
}

/** Load manifest for a specific workflow */
async function loadManifest(name: string) {
  const manifestFile = getWorkflowManifest(name);
  const data = await readYAML<Record<string, unknown>>(manifestFile);
  return {
    name: (data.name as string) || name,
    version: (data.version as string) || "0.0.0",
    description: (data.description as string) || "",
    author: data.author as string | undefined,
    repository: data.repository as string | undefined,
    license: data.license as string | undefined,
  };
}

/** Render ASCII layered topology */
function renderAsciiLayers(
  layers: Map<number, string[]>,
  nodes: Array<{ name: string; kind?: string }>
): void {
  const nodeKindMap = new Map(nodes.map((n) => [n.name, n.kind]));

  for (const [layerIdx, nodeNames] of layers.entries()) {
    const formattedNodes = nodeNames.map((name) => {
      const kind = nodeKindMap.get(name);
      const label = formatNodeLabel(name, kind);
      return label;
    });

    console.log(`Layer ${layerIdx} │ ${formattedNodes.join("  ")}`);
  }
}

/** Format node name with kind prefix/color hint */
function formatNodeLabel(name: string, kind?: string): string {
  if (!kind || kind === "user") {
    return `[${name}]`;
  }

  // Virtual nodes: collect, cond, fanout
  if (kind === "collect") {
    return `[collect:${name.replace("collect-", "")}]`;
  }
  if (kind === "cond") {
    return `[cond:${name}]`;
  }
  if (kind === "fanout") {
    return `[fanout:${name}]`;
  }

  return `[${name}]`;
}

/** Render process status table */
function renderPsTable(runs: Array<{
  id: string;
  status: string;
  graphName?: string;
  createdAt: string;
}>): void {
  if (runs.length === 0) {
    console.log("No workflow instances found.");
    return;
  }

  for (const run of runs) {
    const progress = run.graphName ? "" : ""; // Could add task progress later
    const date = new Date(run.createdAt).toLocaleString();
    console.log(`  ${run.id}  ${run.status}  ${progress}  ${date}`);
  }
}
