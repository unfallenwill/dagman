import type { Command } from "commander";
import * as nodeService from "../services/node-service.js";
import * as stateService from "../services/state-service.js";
import { confirmPrompt } from "../utils/prompt.js";
import { FileExistsError, NodeNotFoundError, ValidationError, CycleError } from "../errors.js";

const NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export function registerNodeCommand(program: Command): void {
  const node = program.command("node").description("节点管理");

  node
    .command("create <name>")
    .description("创建节点模板文件并注册到任务图")
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
            `错误: 节点 '${name}' 已存在，请先使用 node remove 命令删除`
          );
          process.exit(1);
        }
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  node
    .command("add <filepath>")
    .description("从文件导入节点到任务图")
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

  node
    .command("list")
    .description("列出所有节点")
    .action(async () => {
      try {
        const nodes = await nodeService.listNodes();
        if (nodes.length === 0) {
          console.log("暂无已注册节点");
          return;
        }
        for (const n of nodes) {
          console.log(`  ${n.name}`);
        }
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  node
    .command("remove <name>")
    .description("移除节点")
    .option("--force", "跳过确认提示")
    .action(async (name: string, options: { force?: boolean }) => {
      try {
        const dependents = await nodeService.findDependents(name);
        if (dependents.length > 0) {
          console.log(
            `警告: 以下节点依赖 '${name}': ${dependents.join(", ")}`
          );
          if (!options.force) {
            const confirmed = await confirmPrompt("确定要继续删除吗？");
            if (!confirmed) {
              console.log("已取消删除");
              return;
            }
          }
        }

        await nodeService.removeNode(name);
        await stateService.removeState(name);
        console.log(`已移除节点: ${name}`);
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
