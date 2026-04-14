import type { Command } from "commander";
import * as initService from "../services/init-service.js";
import { ValidationError } from "../errors.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init <plan-file>")
    .description("从 YAML plan 文件批量导入 DAG 节点")
    .action(async (filePath: string) => {
      try {
        const { imported, skipped } = await initService.initFromPlan(filePath);

        if (imported.length > 0) {
          console.log(`已导入 ${imported.length} 个节点:`);
          for (const name of imported) {
            console.log(`  ${name}`);
          }
        }

        if (skipped.length > 0) {
          console.log(`已跳过 ${skipped.length} 个已存在的节点:`);
          for (const name of skipped) {
            console.log(`  ${name}`);
          }
        }

        if (imported.length === 0 && skipped.length === 0) {
          console.log("plan 文件中无可导入的节点");
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
