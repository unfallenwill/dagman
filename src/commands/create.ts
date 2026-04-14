import type { Command } from "commander";
import * as nodeService from "../services/node-service.js";
import { FileExistsError } from "../errors.js";

const NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export function registerCreateCommand(program: Command): void {
  program
    .command("create <name>")
    .description("创建节点模板文件")
    .action(async (name: string) => {
      try {
        if (!NAME_REGEX.test(name) || name.length < 1 || name.length > 100) {
          console.error(
            "错误: 节点名称仅允许字母、数字、连字符和下划线，长度 1-100"
          );
          process.exit(1);
        }

        const filePath = await nodeService.createTemplate(name);
        console.log(`已创建节点模板: ${filePath}`);
      } catch (err: unknown) {
        if (err instanceof FileExistsError) {
          console.error(
            `错误: 节点 '${name}' 已存在，请先使用 remove 命令删除`
          );
          process.exit(1);
        }
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
