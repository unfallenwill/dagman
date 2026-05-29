import type { Command } from "commander";
import { getWorkflowManifest } from "../constants.js";
import { graphExists } from "../graph/graph.js";
import { withErrorHandler, outputJson } from "../utils/output.js";
import { readYAML } from "../utils/file.js";

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

export function registerShowCommand(program: Command): void {
  program
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
}
