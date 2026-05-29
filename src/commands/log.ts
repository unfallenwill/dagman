import type { Command } from "commander";
import * as eventService from "../runtime/event-service.js";
import { resolveCurrentRunId } from "../runtime/run-service.js";
import { RunNotFoundError } from "../errors.js";
import { getRunMetaFile } from "../constants.js";
import { fileExists } from "../utils/file.js";

function formatEvent(iso: string, node: string, from: string, to: string): string {
  return `[${iso}] ${node}: ${from} -> ${to}`;
}

export function registerLogCommand(program: Command): void {
  program
    .command("log [node]")
    .description("View execution log")
    .option("--run <runId>", "specify run")
    .action(async (node?: string, options?: { run?: string }) => {
      try {
        const runId = options?.run ?? (await resolveCurrentRunId());
        const metaFile = getRunMetaFile(runId);
        if (!(await fileExists(metaFile))) {
          throw new RunNotFoundError(runId);
        }

        const events = await eventService.readEvents(runId);
        const filtered = node
          ? events.filter((e) => e.node === node)
          : events;

        if (filtered.length === 0) {
          console.log(node ? `No execution log for node '${node}'` : "No execution log");
          return;
        }

        for (const e of filtered) {
          console.log(formatEvent(e.timestamp, e.node, e.from, e.to));
        }
      } catch (err: unknown) {
        if (err instanceof RunNotFoundError) {
          console.error(`Error: Run '${options?.run}' does not exist`);
          process.exit(1);
        }
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
