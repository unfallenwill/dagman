import type { Command } from "commander";
import * as importService from "../services/import-service.js";
import { ValidationError } from "../errors.js";
import * as fs from "fs/promises";

export function registerImportCommand(program: Command): void {
  program
    .command("import [file]")
    .description("从 YAML 文件或标准输入导入节点和图")
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
          console.log(`已导入 ${result.importedNodes.length} 个节点:`);
          for (const name of result.importedNodes) {
            console.log(`  ${name}`);
          }
        }

        if (result.skippedNodes.length > 0) {
          console.log(`已跳过 ${result.skippedNodes.length} 个已存在的节点:`);
          for (const name of result.skippedNodes) {
            console.log(`  ${name}`);
          }
        }

        if (result.importedGraphs.length > 0) {
          console.log(`已导入 ${result.importedGraphs.length} 个图:`);
          for (const name of result.importedGraphs) {
            console.log(`  ${name}`);
          }
        }

        if (result.skippedGraphs.length > 0) {
          console.log(`已跳过 ${result.skippedGraphs.length} 个已存在的图:`);
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
          console.log("YAML 文件中无可导入的内容");
        }
      } catch (err: unknown) {
        if (err instanceof ValidationError) {
          console.error(`错误: ${err.message}`);
          for (const e of err.errors) {
            console.error(`  - ${e}`);
          }
          process.exit(1);
        }
        console.error(`错误: ${(err as Error).message}`);
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
