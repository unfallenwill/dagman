import type { Command } from "commander";
import * as importService from "../io/import.js";
import { ValidationError } from "../errors.js";
import * as fs from "fs/promises";
import { setCommandMeta } from "../utils/command-meta.js";
import { withErrorHandler, outputJson } from "../utils/output.js";

export function registerImportCommand(program: Command): void {
  const importCmd = program
    .command("import [file]")
    .summary("Import nodes and graphs from YAML")
    .description(`Import node and graph definitions from a YAML file or stdin.

The YAML file can contain multiple documents separated by ---.
Each document must specify a kind (Node or Graph) with the
appropriate fields.

Existing definitions with the same name are skipped (not overwritten).`);

  setCommandMeta(importCmd, {
    examples: [
      { description: "Import from a file", command: "dagman import plan.yaml" },
      { description: "Import from stdin", command: "cat plan.yaml | dagman import" },
      { description: "Import and show result as JSON", command: "dagman import plan.yaml --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Import completed (some items may have been skipped)" },
      { code: 1, meaning: "Validation error or file system error" },
    ],
    seeAlso: ["dagman-export(1)", "dagman-node(1)", "dagman-graph(1)"],
    dataProducing: true,
  });

  importCmd
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (filePath?: string, options?: { json?: boolean }) => {
        let content: string;
        if (filePath) {
          content = await fs.readFile(filePath, "utf-8");
        } else {
          content = await readStdin();
        }

        const result = await importService.importFromYAML(content);

        if (options?.json) {
          outputJson(result);
          return;
        }

        if (result.importedNodes.length > 0) {
          console.log(`Imported ${result.importedNodes.length} node(s):`);
          for (const name of result.importedNodes) {
            console.log(`  ${name}`);
          }
        }

        if (result.skippedNodes.length > 0) {
          console.log(`Skipped ${result.skippedNodes.length} existing node(s):`);
          for (const name of result.skippedNodes) {
            console.log(`  ${name}`);
          }
        }

        if (result.importedGraphs.length > 0) {
          console.log(`Imported ${result.importedGraphs.length} graph(s):`);
          for (const name of result.importedGraphs) {
            console.log(`  ${name}`);
          }
        }

        if (result.skippedGraphs.length > 0) {
          console.log(`Skipped ${result.skippedGraphs.length} existing graph(s):`);
          for (const name of result.skippedGraphs) {
            console.log(`  ${name}`);
          }
        }

        if (
          result.importedNodes.length === 0 &&
          result.skippedNodes.length === 0 &&
          result.importedGraphs.length === 0 &&
          result.skippedGraphs.length === 0
        ) {
          console.log("No importable content found in YAML");
        }
      })
    );
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
