import type { Command } from "commander";
import { compileWorkflow } from "../compiler/compiler.js";
import * as runService from "../runtime/run.js";
import { withErrorHandler } from "../utils/output.js";

export function registerStartCommand(program: Command): void {
  program
    .command("start <name>")
    .summary("Start a workflow instance")
    .action(
      withErrorHandler(async (name: string) => {
        // Compile workflow (persists graph, which will be loaded by createRun)
        await compileWorkflow(name);

        // Create run with generated instance ID
        const runInfo = await runService.createRun(undefined, name, true);

        console.log(runInfo.id);
      }),
    );
}
