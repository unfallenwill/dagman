import type { Command } from "commander";
import * as runService from "../runtime/run-service.js";
import * as graphService from "../graph/graph-service.js";
import { RunNotFoundError, GraphNotFoundError } from "../errors.js";

export function registerRunCommand(program: Command): void {
  const run = program.command("run").description("Run management");

  run
    .command("create [label]")
    .description("Create a new run")
    .option("-s, --switch", "switch to new run after creation", false)
    .option("--graph <name>", "bind to graph")
    .action(
      async (
        label?: string,
        options?: { switch?: boolean; graph?: string }
      ) => {
        try {
          if (options?.graph) {
            if (!(await graphService.graphExists(options.graph))) {
              console.error(`Error: Graph '${options.graph}' does not exist`);
              process.exit(1);
            }
          }
          const info = await runService.createRun(
            label,
            options?.graph,
            options?.switch
          );
          console.log(
            `Run created: ${info.id}${info.label ? ` (${info.label})` : ""}`
          );
          if (info.graphName) {
            console.log(`Graph: ${info.graphName}`);
          }
          if (info.layerAssignment) {
            const layers = new Map<number, number>();
            for (const layer of Object.values(info.layerAssignment)) {
              layers.set(layer, (layers.get(layer) ?? 0) + 1);
            }
            const layerInfo = [...layers.entries()]
              .sort(([a], [b]) => a - b)
              .map(([, count]) => `${count}`)
              .join(" -> ");
            console.log(`Layers: ${layerInfo} (${Object.keys(info.layerAssignment).length} nodes)`);
          }
          if (options?.switch) {
            console.log(`Switched to run: ${info.id}`);
          }
        } catch (err: unknown) {
          console.error(`Error: ${(err as Error).message}`);
          process.exit(1);
        }
      }
    );

  run
    .command("list")
    .description("List all runs")
    .action(async () => {
      try {
        const runs = await runService.listRuns();
        if (runs.length === 0) {
          console.log("No runs found");
          return;
        }
        const currentRunId = await runService.getCurrentRunId();
        for (const r of runs) {
          const marker = r.id === currentRunId ? " *" : "";
          const graph = r.graphName ? ` [${r.graphName}]` : "";
          const status = r.status !== "idle" ? ` [${r.status}]` : "";
          console.log(
            `  ${r.id}${r.label ? ` (${r.label})` : ""}${graph}${status}${marker}`
          );
        }
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  run
    .command("switch <run-id>")
    .description("Switch to a run")
    .action(async (runId: string) => {
      try {
        await runService.switchRun(runId);
        console.log(`Switched to run: ${runId}`);
      } catch (err: unknown) {
        if (err instanceof RunNotFoundError) {
          console.error(`Error: Run '${runId}' does not exist`);
          process.exit(1);
        }
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  run
    .command("show [run-id]")
    .description("Show run details (defaults to current run)")
    .action(async (runId?: string) => {
      try {
        const rid = runId ?? (await runService.resolveCurrentRunId());
        const info = await runService.showRun(rid);
        console.log(`Run ID: ${info.id}`);
        if (info.label) console.log(`Label: ${info.label}`);
        if (info.graphName) console.log(`Graph: ${info.graphName}`);
        console.log(`Status: ${info.status}`);
        console.log(`Current step: ${info.currentStep}`);
        console.log(`Created: ${info.createdAt}`);
        console.log(`Tasks: ${info.completedTasks}/${info.taskCount} completed`);
      } catch (err: unknown) {
        if (err instanceof RunNotFoundError) {
          console.error(`Error: Run '${runId}' does not exist`);
          process.exit(1);
        }
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
