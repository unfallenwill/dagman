import type { Command } from "commander";
import * as nextService from "../scheduling/next.js";

export function registerNextCommand(program: Command): void {
  program
    .command("next")
    .description("Get the next executable task in the current superstep")
    .option("-r, --run <run-id>", "specify run (defaults to current)")
    .option("--all", "return all executable tasks in the current superstep")
    .option("--step", "show current superstep status")
    .option("--json", "output in JSON format")
    .action(async (options: { run?: string; all?: boolean; step?: boolean; json?: boolean }) => {
      try {
        if (options.step) {
          const { getCurrentStep } = await import("../workflow/workflow.js");
          const current = await getCurrentStep(options.run);
          console.log(`Current step: ${current.step} [${current.status}]`);
          for (const t of current.tasks) {
            console.log(`  ${t.nodeId} [${t.status}]`);
          }
          return;
        }

        if (options.all) {
          const results = await nextService.findAllNext(options.run);
          if (results.length === 0) {
            console.log("No executable tasks (current superstep completed or workflow finished)");
            return;
          }

          if (options.json) {
            console.log(JSON.stringify(results, null, 2));
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
          console.log("No executable tasks (current superstep completed or workflow finished)");
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
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
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
