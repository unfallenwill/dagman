import type { Command } from "commander";
import * as workflowService from "../workflow/workflow.js";
import * as graphService from "../graph/graph.js";
import * as runService from "../runtime/run.js";

export function registerTaskCommand(program: Command): void {
  const task = program.command("task").description("Task lifecycle management");

  task
    .command("list")
    .description("List tasks in the current superstep")
    .option("--step <step>", "specify superstep number")
    .option("-r, --run <runId>", "specify run")
    .action(async (options: { step?: string; run?: string }) => {
      try {
        const step = options.step ? parseInt(options.step, 10) : undefined;
        const tasks = await workflowService.listTasks(step, options.run);
        if (tasks.length === 0) {
          console.log("No tasks found");
          return;
        }
        for (const t of tasks) {
          const statusDisplay = t.startedAt
            ? `${t.status} (${new Date(t.startedAt).toLocaleTimeString()})`
            : t.status;
          console.log(`  ${t.nodeId} [${statusDisplay}]`);
        }
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("show <node>")
    .description("Show task details")
    .option("-r, --run <runId>", "specify run")
    .action(async (node: string, options: { run?: string }) => {
      try {
        const t = await workflowService.getTask(node, undefined, options.run);
        if (!t) {
          console.error(`Error: Node '${node}' is not in the current superstep`);
          process.exit(1);
        }
        console.log(`Node: ${t.nodeId}`);
        console.log(`Step: ${t.step}`);
        console.log(`Status: ${t.status}`);
        if (t.startedAt) console.log(`Started: ${t.startedAt}`);
        if (t.completedAt) console.log(`Completed: ${t.completedAt}`);
        if (t.error) console.log(`Error: ${t.error}`);
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("start <node>")
    .description("Start task (ready -> running)")
    .option("-r, --run <runId>", "specify run")
    .action(async (node: string, options: { run?: string }) => {
      try {
        const t = await workflowService.startTask(node, options.run);
        console.log(`Task '${node}' started (${t.id})`);
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("complete <node>")
    .description("Complete task (running -> success)")
    .option("-r, --run <runId>", "specify run")
    .action(async (node: string, options: { run?: string }) => {
      try {
        const runId = options.run ?? await runService.resolveCurrentRunId();
        const graphName = await runService.getGraphForRun(runId);
        if (!graphName) {
          console.error("Error: Current run is not bound to a graph");
          process.exit(1);
        }
        const graph = await graphService.loadGraph(graphName);
        const { task: t, advanced } = await workflowService.completeTask(
          node,
          graph.edges,
          options.run
        );
        console.log(`Task '${node}' completed (${t.id})`);
        if (advanced) {
          console.log("Current superstep completed, advancing to next layer");
        }
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("fail <node>")
    .description("Mark task as failed (running -> failed)")
    .option("-r, --run <runId>", "specify run")
    .option("--reason <reason>", "failure reason")
    .action(async (node: string, options: { run?: string; reason?: string }) => {
      try {
        const t = await workflowService.failTask(node, options.reason, options.run);
        console.log(`Task '${node}' marked as failed (${t.id})`);
        if (options.reason) {
          console.log(`Reason: ${options.reason}`);
        }
        console.log("Current superstep paused, use task retry or task skip to resolve");
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("skip <node>")
    .description("Skip task (ready/running -> skipped)")
    .option("-r, --run <runId>", "specify run")
    .action(async (node: string, options: { run?: string }) => {
      try {
        const runId = options.run ?? await runService.resolveCurrentRunId();
        const graphName = await runService.getGraphForRun(runId);
        if (!graphName) {
          console.error("Error: Current run is not bound to a graph");
          process.exit(1);
        }
        const graph = await graphService.loadGraph(graphName);
        const { task: t, advanced } = await workflowService.skipTask(
          node,
          graph.edges,
          options.run
        );
        console.log(`Task '${node}' skipped (${t.id})`);
        if (advanced) {
          console.log("Current superstep completed, advancing to next layer");
        }
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("retry <node>")
    .description("Retry failed task (failed -> ready)")
    .option("-r, --run <runId>", "specify run")
    .action(async (node: string, options: { run?: string }) => {
      try {
        const t = await workflowService.retryTask(node, options.run);
        console.log(`Task '${node}' reset to ready (${t.id}), can be re-executed`);
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
