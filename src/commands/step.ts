import type { Command } from "commander";
import * as workflowService from "../services/workflow-service.js";

export function registerStepCommand(program: Command): void {
  const step = program.command("step").description("Superstep 管理");

  step
    .command("show")
    .description("显示当前 superstep 状态")
    .option("-r, --run <runId>", "指定运行实例")
    .action(async (options: { run?: string }) => {
      try {
        const current = await workflowService.getCurrentStep(options.run);
        console.log(`步骤: ${current.step}`);
        console.log(`状态: ${current.status}`);
        if (current.startedAt) {
          console.log(`开始: ${new Date(current.startedAt).toLocaleString()}`);
        }
        if (current.completedAt) {
          console.log(`完成: ${new Date(current.completedAt).toLocaleString()}`);
        }
        console.log(`任务:`);
        for (const t of current.tasks) {
          const statusDisplay = t.startedAt
            ? `${t.status} (${new Date(t.startedAt).toLocaleTimeString()})`
            : t.status;
          console.log(`  ${t.nodeId} [${statusDisplay}]`);
        }
        const changesCount = Object.keys(current.channelChanges).length;
        if (changesCount > 0) {
          console.log(`channel 变更: ${changesCount} 个`);
        }
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  step
    .command("advance")
    .description("手动推进到下一个 superstep")
    .option("-r, --run <runId>", "指定运行实例")
    .action(async (options: { run?: string }) => {
      try {
        const next = await workflowService.advanceStep(options.run);
        if (!next) {
          console.log("工作流已完成，没有更多步骤");
          return;
        }
        console.log(`已推进到步骤 ${next.step}`);
        console.log(`任务:`);
        for (const t of next.tasks) {
          console.log(`  ${t.nodeId} [${t.status}]`);
        }
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  step
    .command("history")
    .description("显示所有已完成的 superstep 历史")
    .option("-r, --run <runId>", "指定运行实例")
    .action(async (options: { run?: string }) => {
      try {
        const records = await workflowService.getStepHistory(options.run);
        if (records.length === 0) {
          console.log("暂无 superstep 历史");
          return;
        }
        for (const record of records) {
          const tasks = record.tasks
            .map((t) => `${t.nodeId}[${t.status}]`)
            .join(", ");
          const changesCount = Object.keys(record.channelChanges).length;
          console.log(
            `步骤 ${record.step} [${record.status}] — 任务: ${tasks}` +
              (changesCount > 0 ? ` — channels: ${changesCount} 个变更` : "")
          );
        }
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
