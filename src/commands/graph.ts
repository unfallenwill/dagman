import type { Command } from "commander";
import * as graphService from "../services/graph-service.js";
import * as validatorService from "../services/validator.js";
import * as nodeService from "./../services/node-service.js";

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
        const { nodes, edges, tasks, timestamps } = await graphService.buildGraph(
          options.graph,
          options.run
        );
        console.log(graphService.formatGraph(nodes, edges, tasks, timestamps));
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
        const graph = await graphService.loadGraph(options.graph);
        const nodes = await nodeService.listNodes();
        const nodeNames = nodes.map((n) => n.name);
        const results = validatorService.validateGraph(nodeNames, graph.edges);
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
