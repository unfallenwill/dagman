import type { Command } from "commander";
import * as workflowService from "../workflow/workflow.js";
import { setCommandMeta } from "../utils/command-meta.js";
import { withErrorHandler, outputJson } from "../utils/output.js";

export function registerStepCommand(program: Command): void {
  const step = program
    .command("step")
    .summary("Superstep management")
    .description(`Manage supersteps — the BFS-layered execution stages.

Each superstep contains a set of tasks that can execute in parallel.
When all tasks in a step reach terminal state (success/failed/skipped),
the workflow advances to the next layer automatically or manually.`);

  setCommandMeta(step, {
    examples: [
      { description: "Show current step status", command: "dagman step show" },
      { description: "Manually advance to next step", command: "dagman step advance" },
      { description: "View step history", command: "dagman step history" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success" },
      { code: 1, meaning: "Error (run not found, workflow not initialized)" },
    ],
    seeAlso: ["dagman-next(1)", "dagman-task(1)", "dagman-run(1)"],
    dataProducing: false,
  });

  // --- step show ---
  const showCmd = step
    .command("show")
    .summary("Show current superstep status")
    .description(`Display the current superstep's status, tasks, and timing.

Shows the step number, status (pending/running/completed/failed),
start time, completion time, and a list of tasks with their states.`);

  setCommandMeta(showCmd, {
    examples: [
      { description: "Show current step", command: "dagman step show" },
      { description: "Show step for a specific run", command: "dagman step show --run abc123" },
      { description: "Show as JSON", command: "dagman step show --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success" },
      { code: 1, meaning: "Run not found or workflow not initialized" },
    ],
    seeAlso: ["dagman-step-advance(1)", "dagman-step-history(1)", "dagman-task-list(1)"],
    dataProducing: true,
  });

  showCmd
    .option("-r, --run <runId>", "specify run")
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (options: { run?: string; json?: boolean }) => {
        const current = await workflowService.getCurrentStep(options.run);

        if (options.json) {
          outputJson(current);
          return;
        }

        console.log(`Step: ${current.step}`);
        console.log(`Status: ${current.status}`);
        if (current.startedAt) {
          console.log(`Started: ${new Date(current.startedAt).toLocaleString()}`);
        }
        if (current.completedAt) {
          console.log(`Completed: ${new Date(current.completedAt).toLocaleString()}`);
        }
        console.log(`Tasks:`);
        for (const t of current.tasks) {
          const statusDisplay = t.startedAt
            ? `${t.status} (${new Date(t.startedAt).toLocaleTimeString()})`
            : t.status;
          console.log(`  ${t.nodeId} [${statusDisplay}]`);
        }
        const changesCount = Object.keys(current.channelChanges).length;
        if (changesCount > 0) {
          console.log(`Channel changes: ${changesCount}`);
        }
      })
    );

  // --- step advance ---
  const advanceCmd = step
    .command("advance")
    .summary("Manually advance to the next superstep")
    .description(`Force-advance the workflow to the next superstep.

Normally supersteps advance automatically when all tasks complete.
Use this command to manually skip to the next layer, which is useful
when tasks are in failed or skipped state and you want to proceed.`);

  setCommandMeta(advanceCmd, {
    examples: [
      { description: "Advance to next step", command: "dagman step advance" },
      { description: "Advance for a specific run", command: "dagman step advance --run abc123" },
    ],
    exitStatus: [
      { code: 0, meaning: "Advanced successfully or workflow completed" },
      { code: 1, meaning: "Run not found or already at final step" },
    ],
    seeAlso: ["dagman-step-show(1)", "dagman-task-complete(1)"],
    dataProducing: false,
  });

  advanceCmd
    .option("-r, --run <runId>", "specify run")
    .action(
      withErrorHandler(async (options: { run?: string }) => {
        const next = await workflowService.advanceStep(options.run);
        if (!next) {
          console.log("Workflow completed, no more steps");
          return;
        }
        console.log(`Advanced to step ${next.step}`);
        console.log(`Tasks:`);
        for (const t of next.tasks) {
          console.log(`  ${t.nodeId} [${t.status}]`);
        }
      })
    );

  // --- step history ---
  const historyCmd = step
    .command("history")
    .summary("Show completed superstep history")
    .description(`Display the history of all completed supersteps.

Shows each step's number, status, tasks with their final states,
and the number of channel changes.`);

  setCommandMeta(historyCmd, {
    examples: [
      { description: "View step history", command: "dagman step history" },
      { description: "History for a specific run", command: "dagman step history --run abc123" },
      { description: "History as JSON", command: "dagman step history --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success (even if no history exists)" },
    ],
    seeAlso: ["dagman-step-show(1)", "dagman-log(1)"],
    dataProducing: true,
  });

  historyCmd
    .option("-r, --run <runId>", "specify run")
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (options: { run?: string; json?: boolean }) => {
        const records = await workflowService.getStepHistory(options.run);

        if (options.json) {
          outputJson({ records });
          return;
        }

        if (records.length === 0) {
          console.log("No superstep history");
          return;
        }
        for (const record of records) {
          const tasks = record.tasks
            .map((t) => `${t.nodeId}[${t.status}]`)
            .join(", ");
          const changesCount = Object.keys(record.channelChanges).length;
          console.log(
            `Step ${record.step} [${record.status}] — tasks: ${tasks}` +
              (changesCount > 0 ? ` — channels: ${changesCount} changed` : "")
          );
        }
      })
    );
}
