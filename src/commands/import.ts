import type { Command } from "commander";
import * as importService from "../services/import-service.js";
import { ValidationError } from "../errors.js";
import * as fs from "fs/promises";

export function registerImportCommand(program: Command): void {
  program
    .command("import [file]")
    .description("Import nodes and graphs from YAML")
    .action(async (filePath?: string) => {
      try {
        let content: string;
        if (filePath) {
          content = await fs.readFile(filePath, "utf-8");
        } else {
          content = await readStdin();
        }

        const result = await importService.importFromYAML(content);

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
      } catch (err: unknown) {
        if (err instanceof ValidationError) {
          console.error(`Error: ${err.message}`);
          for (const e of err.errors) {
            console.error(`  - ${e}`);
          }
          process.exit(1);
        }
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
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
