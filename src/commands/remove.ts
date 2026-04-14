import type { Command } from "commander";
import * as nodeService from "../services/node-service.js";
import * as stateService from "../services/state-service.js";
import { confirmPrompt } from "../utils/prompt.js";
import { NodeNotFoundError } from "../errors.js";

export function registerRemoveCommand(program: Command): void {
  program
    .command("remove <name>")
    .description("移除节点")
    .action(async (name: string) => {
      try {
        const dependents = await nodeService.findDependents(name);
        if (dependents.length > 0) {
          console.log(
            `警告: 以下节点依赖 '${name}': ${dependents.join(", ")}`
          );
          const confirmed = await confirmPrompt("确定要继续删除吗？");
          if (!confirmed) {
            console.log("已取消删除");
            return;
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
