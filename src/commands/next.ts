import type { Command } from "commander";
import * as nextService from "../services/next-service.js";

export function registerNextCommand(program: Command): void {
  program
    .command("next")
    .description("返回当前 superstep 下一个可执行的 task")
    .option("-r, --run <run-id>", "指定运行实例（默认当前运行）")
    .option("--all", "返回当前 superstep 所有可执行的 tasks")
    .option("--step", "显示当前 superstep 状态")
    .option("--json", "以 JSON 格式输出")
    .action(async (options: { run?: string; all?: boolean; step?: boolean; json?: boolean }) => {
      try {
        if (options.step) {
          const { getCurrentStep } = await import("../services/workflow-service.js");
          const current = await getCurrentStep(options.run);
          console.log(`当前步骤: ${current.step} [${current.status}]`);
          for (const t of current.tasks) {
            console.log(`  ${t.nodeId} [${t.status}]`);
          }
          return;
        }

        if (options.all) {
          const results = await nextService.findAllNext(options.run);
          if (results.length === 0) {
            console.log("没有可执行的任务（当前 superstep 已完成或工作流已结束）");
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
            console.log("---");
          }
          return;
        }

        const result = await nextService.findNext(options.run);
        if (!result) {
          console.log("没有可执行的任务（当前 superstep 已完成或工作流已结束）");
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`节点: ${result.node.name}`);
        console.log(`描述: ${result.node.description}`);
        console.log(`指令: ${result.instructions}`);
        console.log(`步骤: ${result.task.step}`);
        console.log(`状态: ${result.task.status}`);

        // 显示相关 channels
        const nodeChannels = Object.entries(result.channels)
          .filter(([name]) => name.startsWith(`${result.node.name}.`));
        if (nodeChannels.length > 0) {
          console.log("\n节点 channels:");
          for (const [name, ch] of nodeChannels) {
            console.log(`  ${name}: ${ch.value} (v${ch.version})`);
          }
        }
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
