import type { Command } from "commander";
import * as nodeService from "../services/node-service.js";
import * as contextService from "../services/context-service.js";
import { NodeNotFoundError } from "../errors.js";

export function registerContextCommand(program: Command): void {
  const ctx = program.command("context").description("管理节点上下文");

  // 默认 action：查看上下文
  ctx
    .argument("<name>")
    .action(async (name: string) => {
      try {
        await nodeService.getNode(name);
        const context = await contextService.getContext(name);
        if (Object.keys(context).length === 0) {
          console.log(`节点 '${name}' 暂无上下文数据`);
        } else {
          for (const [key, value] of Object.entries(context)) {
            console.log(`  ${key}: ${value}`);
          }
        }
      } catch (err: unknown) {
        if (err instanceof NodeNotFoundError) {
          console.error(`错误: 节点 '${name}' 不存在`);
          process.exit(1);
        }
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  ctx
    .command("set <name> <key> <value>")
    .description("设置上下文字段")
    .action(async (name: string, key: string, value: string) => {
      try {
        await nodeService.getNode(name);
        await contextService.setContextField(name, key, value);
        console.log(`已设置节点 '${name}' 的上下文: ${key} = ${value}`);
      } catch (err: unknown) {
        if (err instanceof NodeNotFoundError) {
          console.error(`错误: 节点 '${name}' 不存在`);
          process.exit(1);
        }
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  ctx
    .command("get <name> <key>")
    .description("获取上下文字段值")
    .action(async (name: string, key: string) => {
      try {
        await nodeService.getNode(name);
        const result = await contextService.getContextField(name, key);
        if (!result.found) {
          console.error(
            `错误: 节点 '${name}' 的上下文中不存在键 '${key}'`
          );
          process.exit(1);
        }
        console.log(result.value);
      } catch (err: unknown) {
        if (err instanceof NodeNotFoundError) {
          console.error(`错误: 节点 '${name}' 不存在`);
          process.exit(1);
        }
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  ctx
    .command("clear <name>")
    .description("清空上下文")
    .action(async (name: string) => {
      try {
        await nodeService.getNode(name);
        await contextService.clearContext(name);
        console.log(`已清空节点 '${name}' 的上下文数据`);
      } catch (err: unknown) {
        if (err instanceof NodeNotFoundError) {
          console.error(`错误: 节点 '${name}' 不存在`);
          process.exit(1);
        }
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
