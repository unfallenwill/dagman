import type { Command } from "commander";
import { WORKFLOWS_DIR, getWorkflowManifest } from "../constants.js";
import { compileWorkflow } from "../compiler/compiler.js";
import { graphExists, saveCompiledGraph } from "../graph/graph.js";
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
    .command("load <name>")
    .summary("Compile and load a workflow")
    .option("--json", "Output as JSON")
    .action(
      withErrorHandler(async (name: string, opts: { json?: boolean }) => {
        const result = await compileWorkflow(name);
        if (opts.json) {
          outputJson({
            name: result.manifest.name,
            version: result.manifest.version,
            nodes: result.nodes.map((n) => ({
              name: n.name,
              kind: n.kind,
              stateKey: n.stateKey,
              targets: n.targets,
            })),
            edges: result.graph.edges,
          });
        } else {
          console.log("Loaded workflow: " + result.manifest.name + " v" + result.manifest.version);
          console.log("  Nodes: " + result.nodes.map((n) => n.name).join(", "));
          console.log("  Edges: " + result.graph.edges.length);
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

  workflow
    .command("validate <name>")
    .summary("Validate manifest and TS file")
    .action(
      withErrorHandler(async (name: string) => {
        const manifest = await loadManifest(name);
        const tsFile = WORKFLOWS_DIR + "/" + name + "/" + name + ".ts";
        const tsExists = await fileExists(tsFile);

        if (!tsExists) {
          throw new ValidationError("TS file not found: " + tsFile);
        }

        console.log("Valid: " + manifest.name + " v" + manifest.version);
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
