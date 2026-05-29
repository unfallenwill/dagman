import type { Command } from "commander";
import * as workflowService from "../workflow/workflow-service.js";

export function registerStepCommand(program: Command): void {
  const step = program.command("step").description("Superstep management");

  step
    .command("show")
    .description("Show current superstep status")
    .option("-r, --run <runId>", "specify run")
    .action(async (options: { run?: string }) => {
      try {
        const current = await workflowService.getCurrentStep(options.run);
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
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  step
    .command("advance")
    .description("Manually advance to the next superstep")
    .option("-r, --run <runId>", "specify run")
    .action(async (options: { run?: string }) => {
      try {
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
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  step
    .command("history")
    .description("Show completed superstep history")
    .option("-r, --run <runId>", "specify run")
    .action(async (options: { run?: string }) => {
      try {
        const records = await workflowService.getStepHistory(options.run);
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
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
