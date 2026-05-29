import type { Command } from "commander";
import * as nextService from "../scheduling/next.js";
import { setCommandMeta } from "../utils/command-meta.js";
import { withErrorHandler, outputJson } from "../utils/output.js";

export function registerNextCommand(program: Command): void {
  const nextCmd = program
    .command("next")
    .summary("Get the next executable task")
    .description(`Get the next executable task in the current superstep.

This is the core scheduling command. It returns the next task that is
ready to execute. Use --all to get all ready tasks in the current
superstep, or --step to check the current superstep status.

The agent execution loop typically follows: next -> task start ->
(execute) -> task complete -> next -> ...`);

  setCommandMeta(nextCmd, {
    examples: [
      { description: "Get the next task", command: "dagman next" },
      { description: "Get all ready tasks", command: "dagman next --all" },
      { description: "Get next task as JSON", command: "dagman next --json" },
      { description: "Check current superstep status", command: "dagman next --step" },
      { description: "All ready tasks as JSON for a specific run", command: "dagman next --all --json --run abc123" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success (task found or no tasks remaining)" },
      { code: 1, meaning: "Error (run not found, workflow not initialized)" },
    ],
    seeAlso: ["dagman-task(1)", "dagman-step(1)", "dagman-run(1)"],
    dataProducing: true,
  });

  nextCmd
    .option("-r, --run <run-id>", "specify run (defaults to current)")
    .option("--all", "return all executable tasks in the current superstep")
    .option("--step", "show current superstep status")
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (options: { run?: string; all?: boolean; step?: boolean; json?: boolean }) => {
        if (options.step) {
          const { getCurrentStep } = await import("../workflow/workflow.js");
          const current = await getCurrentStep(options.run);

          if (options.json) {
            outputJson(current);
            return;
          }

          console.log(`Current step: ${current.step} [${current.status}]`);
          for (const t of current.tasks) {
            console.log(`  ${t.nodeId} [${t.status}]`);
          }
          return;
        }

        if (options.all) {
          const results = await nextService.findAllNext(options.run);
          if (results.length === 0) {
            if (options.json) {
              outputJson([]);
              return;
            }
            console.log("No executable tasks (current superstep completed or workflow finished)");
            return;
          }

          if (options.json) {
            outputJson(results);
            return;
          }

          for (const result of results) {
            console.log(`Node: ${result.node.name}`);
            console.log(`Description: ${result.node.description}`);
            console.log(`Instructions: ${result.instructions}`);
            console.log("---");
          }
          return;
        }

        const result = await nextService.findNext(options.run);
        if (!result) {
          if (options.json) {
            outputJson(null);
            return;
          }
          console.log("No executable tasks (current superstep completed or workflow finished)");
          return;
        }

        if (options.json) {
          outputJson(result);
          return;
        }

        console.log(`Node: ${result.node.name}`);
        console.log(`Description: ${result.node.description}`);
        console.log(`Instructions: ${result.instructions}`);
        console.log(`Step: ${result.task.step}`);
        console.log(`Status: ${result.task.status}`);

        // Show related channels
        const nodeChannels = Object.entries(result.channels)
          .filter(([name]) => name.startsWith(`${result.node.name}.`));
        if (nodeChannels.length > 0) {
          console.log("\nNode channels:");
          for (const [name, ch] of nodeChannels) {
            console.log(`  ${name}: ${ch.value} (v${ch.version})`);
          }
        }
      })
    );
}
