import type { Command } from "commander";
import * as nodeService from "../services/node-service.js";
import * as stateService from "../services/state-service.js";
import { CHANGEABLE_STATES } from "../models/state.js";
import { NodeNotFoundError } from "../errors.js";

export function registerStatusCommand(program: Command): void {
  const status = program.command("status").description("状态管理");

  status
    .command("set <name> <state>")
    .description("设置节点状态")
    .action(async (name: string, state: string) => {
      try {
        await nodeService.getNode(name);

        if (state === "pending") {
          console.error(`错误: 不可将节点状态回退为 'pending'`);
          process.exit(1);
        }

        if (!(CHANGEABLE_STATES as readonly string[]).includes(state)) {
          console.error(
            `错误: 状态 '${state}' 无效，可用状态: ${CHANGEABLE_STATES.join(", ")}`
          );
          process.exit(1);
        }

        await stateService.setState(name, state);
        console.log(`已更新节点 '${name}' 的状态为 '${state}'`);
      } catch (err: unknown) {
        if (err instanceof NodeNotFoundError) {
          console.error(`错误: 节点 '${name}' 不存在`);
          process.exit(1);
        }
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  status
    .command("show <name>")
    .description("查看节点状态")
    .action(async (name: string) => {
      try {
        await nodeService.getNode(name);
        const states = await stateService.getState();
        const current = states[name];
        if (!current) {
          console.log("pending");
        } else {
          console.log(current);
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
}
