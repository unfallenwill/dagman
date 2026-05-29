import type { Command } from "commander";
import * as exportService from "../services/export-service.js";
import * as fs from "fs/promises";

export function registerExportCommand(program: Command): void {
  program
    .command("export [file]")
    .description("Export nodes and graphs as YAML (default: stdout)")
    .option("--graph <name>", "export specified graph and its referenced nodes")
    .action(async (filePath?: string, options?: { graph?: string }) => {
      try {
        const content = options?.graph
          ? await exportService.exportToYAML(options.graph)
          : await exportService.exportToYAML();

        if (filePath) {
          await fs.writeFile(filePath, content, "utf-8");
          console.log(`Exported to ${filePath}`);
        } else {
          process.stdout.write(content);
        }
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
