import type { Command } from "commander";
import * as exportService from "../services/export-service.js";
import * as fs from "fs/promises";

export function registerExportCommand(program: Command): void {
  program
    .command("export [file]")
    .description("导出节点和图为 YAML（默认输出到标准输出）")
    .option("--graph <name>", "导出指定图及其引用的节点")
    .action(async (filePath?: string, options?: { graph?: string }) => {
      try {
        const content = options?.graph
          ? await exportService.exportToYAML(options.graph)
          : await exportService.exportToYAML();

        if (filePath) {
          await fs.writeFile(filePath, content, "utf-8");
          console.log(`已导出到 ${filePath}`);
        } else {
          process.stdout.write(content);
        }
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
