import type { Command } from "commander";
import * as workflowService from "../workflow/workflow.js";
import * as graphService from "../graph/graph.js";
import * as runService from "../runtime/run.js";
import { CliError } from "../errors.js";
import { setCommandMeta } from "../utils/command-meta.js";
import { withErrorHandler, outputJson } from "../utils/output.js";

export function registerTaskCommand(program: Command): void {
  const task = program
    .command("task")
    .summary("Task lifecycle management")
    .description(`Manage task lifecycle within a run.

Tasks are runtime entities created from nodes. Each task progresses
through states: ready -> running -> success / failed / skipped.
Failed tasks can be reset to ready via retry.`);

  setCommandMeta(task, {
    examples: [
      { description: "List tasks in current step", command: "dagman task list" },
      { description: "Start a task", command: "dagman task start build" },
      { description: "Complete a task", command: "dagman task complete build" },
      { description: "Mark task as failed", command: 'dagman task fail build --reason "compile error"' },
      { description: "Retry a failed task", command: "dagman task retry build" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success" },
      { code: 1, meaning: "Error (task not found, invalid state transition)" },
    ],
    seeAlso: ["dagman-next(1)", "dagman-step(1)", "dagman-run(1)"],
    dataProducing: false,
  });

  // --- task list ---
  const listCmd = task
    .command("list")
    .summary("List tasks in the current superstep")
    .description(`List all tasks in the current or specified superstep.

Shows task node name, status, and start time for each task.`);

  setCommandMeta(listCmd, {
    examples: [
      { description: "List tasks in current step", command: "dagman task list" },
      { description: "List tasks in a specific step", command: "dagman task list --step 2" },
      { description: "List tasks as JSON", command: "dagman task list --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success (even if no tasks found)" },
    ],
    seeAlso: ["dagman-task-show(1)", "dagman-step-show(1)"],
    dataProducing: true,
  });

  listCmd
    .option("--step <step>", "specify superstep number")
    .option("-r, --run <runId>", "specify run")
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (options: { step?: string; run?: string; json?: boolean }) => {
        const step = options.step ? parseInt(options.step, 10) : undefined;
        const tasks = await workflowService.listTasks(step, options.run);

        if (options.json) {
          outputJson({ tasks });
          return;
        }

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
      })
    );

  // --- task show ---
  const showCmd = task
    .command("show <node>")
    .summary("Show task details")
    .description(`Display detailed information about a specific task.

Shows node name, step, status, and timestamps.`);

  setCommandMeta(showCmd, {
    examples: [
      { description: "Show task details", command: "dagman task show build" },
      { description: "Show task as JSON", command: "dagman task show build --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success" },
      { code: 1, meaning: "Task not found in current superstep" },
    ],
    seeAlso: ["dagman-task-list(1)", "dagman-task-start(1)"],
    dataProducing: true,
  });

  showCmd
    .option("-r, --run <runId>", "specify run")
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (node: string, options: { run?: string; json?: boolean }) => {
        const t = await workflowService.getTask(node, undefined, options.run);
        if (!t) {
          throw new CliError(`Node '${node}' is not in the current superstep`);
        }

        if (options.json) {
          outputJson(t);
          return;
        }

        console.log(`Node: ${t.nodeId}`);
        console.log(`Step: ${t.step}`);
        console.log(`Status: ${t.status}`);
        if (t.startedAt) console.log(`Started: ${t.startedAt}`);
        if (t.completedAt) console.log(`Completed: ${t.completedAt}`);
        if (t.error) console.log(`Error: ${t.error}`);
      })
    );

  // --- task start ---
  const startCmd = task
    .command("start <node>")
    .summary("Start task (ready -> running)")
    .description(`Mark a task as running, indicating execution has begun.

The task must be in the 'ready' state.`);

  setCommandMeta(startCmd, {
    examples: [
      { description: "Start a task", command: "dagman task start build" },
      { description: "Start as JSON", command: "dagman task start build --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Task started successfully" },
      { code: 1, meaning: "Task not found or not in ready state" },
    ],
    seeAlso: ["dagman-task-complete(1)", "dagman-task-fail(1)", "dagman-next(1)"],
    dataProducing: true,
  });

  startCmd
    .option("-r, --run <runId>", "specify run")
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (node: string, options: { run?: string; json?: boolean }) => {
        const t = await workflowService.startTask(node, options.run);

        if (options.json) {
          outputJson(t);
          return;
        }

        console.log(`Task '${node}' started (${t.id})`);
      })
    );

  // --- task complete ---
  const completeCmd = task
    .command("complete <node>")
    .summary("Complete task (running -> success)")
    .description(`Mark a task as successfully completed.

The task must be in the 'running' state. If this was the last task in
the current superstep, the workflow automatically advances to the next
layer.`);

  setCommandMeta(completeCmd, {
    examples: [
      { description: "Complete a task", command: "dagman task complete build" },
      { description: "Complete as JSON", command: "dagman task complete build --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Task completed successfully" },
      { code: 1, meaning: "Task not found or not in running state" },
    ],
    seeAlso: ["dagman-task-start(1)", "dagman-task-fail(1)", "dagman-step-advance(1)"],
    dataProducing: true,
  });

  completeCmd
    .option("-r, --run <runId>", "specify run")
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (node: string, options: { run?: string; json?: boolean }) => {
        const runId = options.run ?? await runService.resolveCurrentRunId();
        const graphName = await runService.getGraphForRun(runId);
        if (!graphName) {
          throw new CliError("Current run is not bound to a graph");
        }
        const graph = await graphService.loadGraph(graphName);
        const { task: t, advanced } = await workflowService.completeTask(
          node,
          graph.edges,
          options.run
        );

        if (options.json) {
          outputJson({ task: t, advanced });
          return;
        }

        console.log(`Task '${node}' completed (${t.id})`);
        if (advanced) {
          console.log("Current superstep completed, advancing to next layer");
        }
      })
    );

  // --- task fail ---
  const failCmd = task
    .command("fail <node>")
    .summary("Mark task as failed (running -> failed)")
    .description(`Mark a task as failed, pausing the current superstep.

The task must be in the 'running' state. The superstep will pause and
wait for manual intervention (task retry or task skip).`);

  setCommandMeta(failCmd, {
    examples: [
      { description: "Fail a task", command: "dagman task fail build" },
      { description: "Fail with a reason", command: 'dagman task fail build --reason "compile error"' },
      { description: "Fail as JSON", command: "dagman task fail build --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Task marked as failed" },
      { code: 1, meaning: "Task not found or not in running state" },
    ],
    seeAlso: ["dagman-task-retry(1)", "dagman-task-skip(1)"],
    dataProducing: true,
  });

  failCmd
    .option("-r, --run <runId>", "specify run")
    .option("--reason <reason>", "failure reason")
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (node: string, options: { run?: string; reason?: string; json?: boolean }) => {
        const t = await workflowService.failTask(node, options.reason, options.run);

        if (options.json) {
          outputJson(t);
          return;
        }

        console.log(`Task '${node}' marked as failed (${t.id})`);
        if (options.reason) {
          console.log(`Reason: ${options.reason}`);
        }
        console.log("Current superstep paused, use task retry or task skip to resolve");
      })
    );

  // --- task skip ---
  const skipCmd = task
    .command("skip <node>")
    .summary("Skip task (ready/running -> skipped)")
    .description(`Skip a task, treating it as if it succeeded for dependency purposes.

A skipped task satisfies downstream "success" expectations. The task
must be in the 'ready' or 'running' state.`);

  setCommandMeta(skipCmd, {
    examples: [
      { description: "Skip a task", command: "dagman task skip optional-check" },
      { description: "Skip as JSON", command: "dagman task skip optional-check --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Task skipped successfully" },
      { code: 1, meaning: "Task not found or already in terminal state" },
    ],
    seeAlso: ["dagman-task-complete(1)", "dagman-task-retry(1)"],
    dataProducing: true,
  });

  skipCmd
    .option("-r, --run <runId>", "specify run")
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (node: string, options: { run?: string; json?: boolean }) => {
        const runId = options.run ?? await runService.resolveCurrentRunId();
        const graphName = await runService.getGraphForRun(runId);
        if (!graphName) {
          throw new CliError("Current run is not bound to a graph");
        }
        const graph = await graphService.loadGraph(graphName);
        const { task: t, advanced } = await workflowService.skipTask(
          node,
          graph.edges,
          options.run
        );

        if (options.json) {
          outputJson({ task: t, advanced });
          return;
        }

        console.log(`Task '${node}' skipped (${t.id})`);
        if (advanced) {
          console.log("Current superstep completed, advancing to next layer");
        }
      })
    );

  // --- task retry ---
  const retryCmd = task
    .command("retry <node>")
    .summary("Retry failed task (failed -> ready)")
    .description(`Reset a failed task back to ready state so it can be re-executed.

The task must be in the 'failed' state.`);

  setCommandMeta(retryCmd, {
    examples: [
      { description: "Retry a failed task", command: "dagman task retry build" },
      { description: "Retry as JSON", command: "dagman task retry build --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Task reset to ready" },
      { code: 1, meaning: "Task not found or not in failed state" },
    ],
    seeAlso: ["dagman-task-fail(1)", "dagman-task-start(1)"],
    dataProducing: true,
  });

  retryCmd
    .option("-r, --run <runId>", "specify run")
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (node: string, options: { run?: string; json?: boolean }) => {
        const t = await workflowService.retryTask(node, options.run);

        if (options.json) {
          outputJson(t);
          return;
        }

        console.log(`Task '${node}' reset to ready (${t.id}), can be re-executed`);
      })
    );
}
