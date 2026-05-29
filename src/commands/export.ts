import type { Command } from "commander";
import * as exportService from "../io/export.js";
import * as fs from "fs/promises";
import { setCommandMeta } from "../utils/command-meta.js";
import { withErrorHandler } from "../utils/output.js";

export function registerExportCommand(program: Command): void {
  const exportCmd = program
    .command("export [file]")
    .summary("Export nodes and graphs as YAML")
    .description(`Export node and graph definitions as YAML.

Outputs to stdout by default. Use a file path argument to write to a file.
Use --graph to export only a specific graph and its referenced nodes.`);

  setCommandMeta(exportCmd, {
    examples: [
      { description: "Export all to stdout", command: "dagman export" },
      { description: "Export to a file", command: "dagman export backup.yaml" },
      { description: "Export a specific graph", command: "dagman export --graph pipeline" },
    ],
    exitStatus: [
      { code: 0, meaning: "Export completed" },
      { code: 1, meaning: "Graph not found or file system error" },
    ],
    seeAlso: ["dagman-import(1)", "dagman-node-list(1)", "dagman-graph-list(1)"],
    dataProducing: false,
  });

  exportCmd
    .option("--graph <name>", "export specified graph and its referenced nodes")
    .action(
      withErrorHandler(async (filePath?: string, options?: { graph?: string }) => {
        const content = options?.graph
          ? await exportService.exportToYAML(options.graph)
          : await exportService.exportToYAML();

        if (filePath) {
          await fs.writeFile(filePath, content, "utf-8");
          console.log(`Exported to ${filePath}`);
        } else {
          process.stdout.write(content);
        }
      })
    );
}
