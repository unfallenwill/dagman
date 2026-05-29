import type { Command } from "commander";
import * as workflowService from "../services/workflow-service.js";
import * as graphService from "../services/graph-service.js";
import * as runService from "../services/run-service.js";

export function registerTaskCommand(program: Command): void {
  const task = program.command("task").description("任务生命周期管理");

  task
    .command("list")
    .description("列出当前 superstep 的所有任务")
    .option("--step <step>", "指定 superstep 编号")
    .option("-r, --run <runId>", "指定运行实例")
    .action(async (options: { step?: string; run?: string }) => {
      try {
        const step = options.step ? parseInt(options.step, 10) : undefined;
        const tasks = await workflowService.listTasks(step, options.run);
        if (tasks.length === 0) {
          console.log("暂无任务");
          return;
        }
        for (const t of tasks) {
          const statusDisplay = t.startedAt
            ? `${t.status} (${new Date(t.startedAt).toLocaleTimeString()})`
            : t.status;
          console.log(`  ${t.nodeId} [${statusDisplay}]`);
        }
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("show <node>")
    .description("查看任务详情")
    .option("-r, --run <runId>", "指定运行实例")
    .action(async (node: string, options: { run?: string }) => {
      try {
        const t = await workflowService.getTask(node, undefined, options.run);
        if (!t) {
          console.error(`错误: 节点 '${node}' 不在当前 superstep 中`);
          process.exit(1);
        }
        console.log(`节点: ${t.nodeId}`);
        console.log(`步骤: ${t.step}`);
        console.log(`状态: ${t.status}`);
        if (t.startedAt) console.log(`开始: ${t.startedAt}`);
        if (t.completedAt) console.log(`完成: ${t.completedAt}`);
        if (t.error) console.log(`错误: ${t.error}`);
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("start <node>")
    .description("启动任务 (ready → running)")
    .option("-r, --run <runId>", "指定运行实例")
    .action(async (node: string, options: { run?: string }) => {
      try {
        const t = await workflowService.startTask(node, options.run);
        console.log(`已启动任务 '${node}' (${t.id})`);
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("complete <node>")
    .description("完成任务 (running → success)")
    .option("-r, --run <runId>", "指定运行实例")
    .action(async (node: string, options: { run?: string }) => {
      try {
        const runId = options.run ?? await runService.resolveCurrentRunId();
        const graphName = await runService.getGraphForRun(runId);
        if (!graphName) {
          console.error("错误: 当前运行实例未绑定图");
          process.exit(1);
        }
        const graph = await graphService.loadGraph(graphName);
        const { task: t, advanced } = await workflowService.completeTask(
          node,
          graph.edges,
          options.run
        );
        console.log(`已完成任务 '${node}' (${t.id})`);
        if (advanced) {
          console.log("当前 superstep 已完成，自动推进到下一层");
        }
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("fail <node>")
    .description("标记任务失败 (running → failed)")
    .option("-r, --run <runId>", "指定运行实例")
    .option("--reason <reason>", "失败原因")
    .action(async (node: string, options: { run?: string; reason?: string }) => {
      try {
        const t = await workflowService.failTask(node, options.reason, options.run);
        console.log(`任务 '${node}' 已标记为失败 (${t.id})`);
        if (options.reason) {
          console.log(`原因: ${options.reason}`);
        }
        console.log("当前 superstep 已暂停，请使用 task retry 或 task skip 处理");
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("skip <node>")
    .description("跳过任务 (ready/running → skipped)")
    .option("-r, --run <runId>", "指定运行实例")
    .action(async (node: string, options: { run?: string }) => {
      try {
        const runId = options.run ?? await runService.resolveCurrentRunId();
        const graphName = await runService.getGraphForRun(runId);
        if (!graphName) {
          console.error("错误: 当前运行实例未绑定图");
          process.exit(1);
        }
        const graph = await graphService.loadGraph(graphName);
        const { task: t, advanced } = await workflowService.skipTask(
          node,
          graph.edges,
          options.run
        );
        console.log(`已跳过任务 '${node}' (${t.id})`);
        if (advanced) {
          console.log("当前 superstep 已完成，自动推进到下一层");
        }
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("retry <node>")
    .description("重试失败的任务 (failed → ready)")
    .option("-r, --run <runId>", "指定运行实例")
    .action(async (node: string, options: { run?: string }) => {
      try {
        const t = await workflowService.retryTask(node, options.run);
        console.log(`已重置任务 '${node}' 为就绪状态 (${t.id})，可以重新执行`);
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
