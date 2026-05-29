import type { Command } from "commander";
import type { Task } from "../models/task.js";
import * as graphService from "../graph/graph-service.js";
import * as validatorService from "../graph/validator.js";
import * as nodeService from "../graph/node-service.js";
import * as workflowService from "../workflow/workflow-service.js";
import * as eventService from "../runtime/event-service.js";
import { resolveCurrentRunId } from "../utils/run-resolver.js";

export function registerGraphCommand(program: Command): void {
  const graph = program.command("graph").description("Graph operations");

  graph
    .command("list")
    .description("List all graphs")
    .action(async () => {
      try {
        const graphs = await graphService.listGraphs();
        if (graphs.length === 0) {
          console.log("No graphs registered");
          return;
        }
        for (const g of graphs) {
          console.log(`  ${g.name} (${g.edges.length} edges)`);
        }
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  graph
    .command("show")
    .description("Show graph structure")
    .requiredOption("--graph <name>", "graph name")
    .option("--run <runId>", "specify run")
    .action(async (options: { graph: string; run?: string }) => {
      try {
        const runId = options.run ?? (await resolveCurrentRunId());
        const graphData = await graphService.loadGraph(options.graph);
        const nodes = await nodeService.listNodes();

        let tasks: Task[] = [];
        try {
          const currentStep = await workflowService.getCurrentStep(runId);
          tasks = currentStep.tasks;
        } catch {
          // workflow not initialized
        }

        const timestamps = await eventService.getNodeTimestamps(runId);
        console.log(
          graphService.formatGraph(nodes, graphData.edges, tasks, timestamps)
        );
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  graph
    .command("validate")
    .description("Validate graph")
    .requiredOption("--graph <name>", "graph name")
    .action(async (options: { graph: string }) => {
      try {
        const graphData = await graphService.loadGraph(options.graph);
        const nodes = await nodeService.listNodes();
        const nodeNames = nodes.map((n) => n.name);
        const results = validatorService.validateGraph(nodeNames, graphData.edges);
        console.log(validatorService.formatValidationResults(results));
        if (results.some((r) => r.level === "error" && !r.passed)) {
          process.exit(1);
        }
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
