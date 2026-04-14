import type { Command } from "commander";
import * as nodeService from "../services/node-service.js";
import { ValidationError, FileExistsError, NodeNotFoundError, CycleError } from "../errors.js";

export function registerAddCommand(program: Command): void {
  program
    .command("add <filepath>")
    .description("注册节点到任务图")
    .action(async (filePath: string) => {
      try {
        const node = await nodeService.addNode(filePath);
        console.log(`已注册节点: ${node.name}`);
      } catch (err: unknown) {
        if (err instanceof NodeNotFoundError) {
          console.error(`错误: 文件 '${filePath}' 不存在`);
          process.exit(1);
        }
        if (err instanceof ValidationError) {
          console.error("错误: 节点文件格式不合法");
          for (const e of err.errors) {
            console.error(`  - ${e}`);
          }
          process.exit(1);
        }
        if (err instanceof FileExistsError) {
          console.error(`错误: 节点 '${err.message}' 已注册`);
          process.exit(1);
        }
        if (err instanceof CycleError) {
          console.error(`错误: ${err.message}`);
          process.exit(1);
        }
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
