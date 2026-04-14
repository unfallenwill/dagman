import type { Command } from "commander";
import * as nodeService from "../services/node-service.js";
import * as stateService from "../services/state-service.js";
import { NodeNotFoundError } from "../errors.js";

export function registerChangeCommand(program: Command): void {
  program
    .command("change <name> <status>")
    .description("变更节点状态")
    .action(async (name: string, status: string) => {
      try {
        const node = await nodeService.getNode(name);
        if (!node.states.includes(status)) {
          console.error(
            `错误: 状态 '${status}' 不在节点 '${name}' 的可用状态中: ${node.states.join(", ")}`
          );
          process.exit(1);
        }
        await stateService.setState(name, status);
        console.log(`已更新节点 '${name}' 的状态为 '${status}'`);
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
