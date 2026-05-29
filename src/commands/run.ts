import type { Command } from "commander";
import * as runService from "../runtime/run.js";
import * as graphService from "../graph/graph.js";
import { RunNotFoundError, GraphNotFoundError, CliError } from "../errors.js";
import { setCommandMeta } from "../utils/command-meta.js";
import { withErrorHandler, outputJson } from "../utils/output.js";

function assertGraphExists(name: string): Promise<void> {
  return graphService.graphExists(name).then((exists) => {
    if (!exists) throw new GraphNotFoundError(name);
  });
}

export function registerRunCommand(program: Command): void {
  const run = program
    .command("run")
    .summary("Run management")
    .description(`Manage run instances.

A run is an execution instance of a graph. Creating a run with --graph
auto-computes topological layers for superstep execution.`);

  setCommandMeta(run, {
    examples: [
      { description: "Create a run bound to a graph", command: "dagman run create --graph pipeline -s" },
      { description: "List all runs", command: "dagman run list" },
      { description: "Switch to a specific run", command: "dagman run switch abc123" },
      { description: "Show current run details", command: "dagman run show" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success" },
      { code: 1, meaning: "Error (run not found, graph not found)" },
    ],
    seeAlso: ["dagman-next(1)", "dagman-task(1)", "dagman-step(1)"],
    dataProducing: false,
  });

  const createCmd = run
    .command("create [label]")
    .summary("Create a new run")
    .description(`Create a new run instance.

When --graph is specified, the run is bound to that graph and
topological layers are auto-computed. Use -s to automatically switch
to the new run after creation.`);

  setCommandMeta(createCmd, {
    examples: [
      { description: "Create a run and switch to it", command: "dagman run create --graph pipeline -s" },
      { description: "Create a labeled run", command: 'dagman run create "v1 deployment" --graph deploy' },
      { description: "Create as JSON", command: "dagman run create --graph pipeline --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Run created successfully" },
      { code: 1, meaning: "Graph not found or file system error" },
    ],
    seeAlso: ["dagman-run-list(1)", "dagman-run-switch(1)", "dagman-run-show(1)"],
    dataProducing: true,
  });

  createCmd
    .option("-s, --switch", "switch to new run after creation", false)
    .option("--graph <name>", "bind to graph")
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(
        async (
          label?: string,
          options?: { switch?: boolean; graph?: string; json?: boolean },
        ) => {
          if (options?.graph) {
            await assertGraphExists(options.graph);
          }

          const info = await runService.createRun(
            label,
            options?.graph,
            options?.switch
          );

          if (options?.json) {
            outputJson({
              runId: info.id,
              label: info.label ?? null,
              graphName: info.graphName ?? null,
              layerAssignment: info.layerAssignment ?? null,
            });
            return;
          }

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
        }
      )
    );

  const listCmd = run
    .command("list")
    .summary("List all runs")
    .description(`List all run instances.

The current active run is marked with an asterisk (*).`);

  setCommandMeta(listCmd, {
    examples: [
      { description: "List all runs", command: "dagman run list" },
      { description: "List runs as JSON", command: "dagman run list --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success (even if no runs exist)" },
    ],
    seeAlso: ["dagman-run-create(1)", "dagman-run-switch(1)"],
    dataProducing: true,
  });

  listCmd
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (options: { json?: boolean }) => {
        const runs = await runService.listRuns();
        const currentRunId = await runService.getCurrentRunId();

        if (options.json) {
          outputJson({ runs, currentRunId: currentRunId ?? null });
          return;
        }

        if (runs.length === 0) {
          console.log("No runs found");
          return;
        }
        for (const r of runs) {
          const marker = r.id === currentRunId ? " *" : "";
          const graph = r.graphName ? ` [${r.graphName}]` : "";
          const status = r.status !== "idle" ? ` [${r.status}]` : "";
          console.log(
            `  ${r.id}${r.label ? ` (${r.label})` : ""}${graph}${status}${marker}`
          );
        }
      })
    );

  const switchCmd = run
    .command("switch <run-id>")
    .summary("Switch to a run")
    .description(`Set the specified run as the current active run.

All subsequent commands that default to "current run" will use this run.`);

  setCommandMeta(switchCmd, {
    examples: [
      { description: "Switch to a run", command: "dagman run switch abc123" },
    ],
    exitStatus: [
      { code: 0, meaning: "Switched successfully" },
      { code: 1, meaning: "Run not found" },
    ],
    seeAlso: ["dagman-run-list(1)", "dagman-run-create(1)"],
    dataProducing: false,
  });

  switchCmd.action(
    withErrorHandler(async (runId: string) => {
      await runService.switchRun(runId);
      console.log(`Switched to run: ${runId}`);
    })
  );

  const showCmd = run
    .command("show [run-id]")
    .summary("Show run details")
    .description(`Display detailed information about a run.

Shows run ID, label, bound graph, status, current step, creation time,
and task completion progress. Defaults to the current run if no ID is given.`);

  setCommandMeta(showCmd, {
    examples: [
      { description: "Show current run details", command: "dagman run show" },
      { description: "Show specific run", command: "dagman run show abc123" },
      { description: "Show as JSON", command: "dagman run show --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success" },
      { code: 1, meaning: "Run not found" },
    ],
    seeAlso: ["dagman-run-list(1)", "dagman-run-create(1)", "dagman-step-show(1)"],
    dataProducing: true,
  });

  showCmd
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (runId?: string, options?: { json?: boolean }) => {
        const rid = runId ?? (await runService.resolveCurrentRunId());
        const info = await runService.showRun(rid);

        if (options?.json) {
          outputJson(info);
          return;
        }

        console.log(`Run ID: ${info.id}`);
        if (info.label) console.log(`Label: ${info.label}`);
        if (info.graphName) console.log(`Graph: ${info.graphName}`);
        console.log(`Status: ${info.status}`);
        console.log(`Current step: ${info.currentStep}`);
        console.log(`Created: ${info.createdAt}`);
        console.log(`Tasks: ${info.completedTasks}/${info.taskCount} completed`);
      })
    );
}
