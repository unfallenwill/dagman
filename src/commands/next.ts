import type { Command } from "commander";
import * as nextService from "../services/next-service.js";
import { CHANGEABLE_STATES } from "../models/state.js";

export function registerNextCommand(program: Command): void {
  program
    .command("next")
    .description("返回下一个可执行的节点")
    .option("-r, --run <run-id>", "指定运行实例（默认当前运行）")
    .option("--all", "返回所有可执行节点")
    .option("--json", "以 JSON 格式输出")
    .action(async (options: { run?: string; all?: boolean; json?: boolean }) => {
      try {
        if (options.all) {
          const results = await nextService.findAllNextNodes(options.run);
          if (results.length === 0) {
            console.log("没有可执行的节点（所有节点已完成或依赖未满足）");
            return;
          }

          if (options.json) {
            console.log(JSON.stringify(results, null, 2));
            return;
          }

          for (const result of results) {
            console.log(`节点: ${result.node.name}`);
            console.log(`描述: ${result.node.description}`);
            console.log(`指令: ${result.instructions}`);
            console.log(`可用状态: ${CHANGEABLE_STATES.join(", ")}`);
            console.log("---");
          }
          return;
        }

        const result = await nextService.findNextNode(options.run);
        if (!result) {
          console.log("没有可执行的节点（所有节点已完成或依赖未满足）");
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`节点: ${result.node.name}`);
        console.log(`描述: ${result.node.description}`);
        console.log(`指令: ${result.instructions}`);
        console.log(`可用状态: ${CHANGEABLE_STATES.join(", ")}`);

        if (Object.keys(result.upstreamContext).length > 0) {
          console.log("\n上游上下文:");
          for (const [depName, ctx] of Object.entries(result.upstreamContext)) {
            if (Object.keys(ctx).length > 0) {
              console.log(`  [${depName}]:`);
              for (const [k, v] of Object.entries(ctx)) {
                console.log(`    ${k}: ${v}`);
              }
            }
          }
        }

        if (Object.keys(result.context).length > 0) {
          console.log("\n当前上下文:");
          for (const [k, v] of Object.entries(result.context)) {
            console.log(`  ${k}: ${v}`);
          }
        }
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
