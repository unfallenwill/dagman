import type { Command } from "commander";
import type { Task } from "../models/task.js";
import * as graphService from "../graph/graph.js";
import * as validatorService from "../graph/validator.js";
import * as nodeService from "../graph/node.js";
import * as workflowService from "../workflow/workflow.js";
import * as eventService from "../runtime/event.js";
import { resolveCurrentRunId } from "../utils/run-resolver.js";
import { CliError } from "../errors.js";
import { setCommandMeta } from "../utils/command-meta.js";
import { withErrorHandler, outputJson } from "../utils/output.js";

export function registerGraphCommand(program: Command): void {
  const graph = program
    .command("graph")
    .summary("Graph operations")
    .description(`Manage and inspect DAG graph definitions.

Graphs define the topology of task dependencies via an edges list.
Each edge declares that one node depends on another.`);

  setCommandMeta(graph, {
    examples: [
      { description: "List all graphs", command: "dagman graph list" },
      { description: "Show graph with task status", command: "dagman graph show --graph pipeline" },
      { description: "Validate a graph", command: "dagman graph validate --graph pipeline" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success" },
      { code: 1, meaning: "Error (graph not found, validation failure)" },
    ],
    seeAlso: ["dagman-node(1)", "dagman-run(1)", "dagman-import(1)"],
    dataProducing: false,
  });

  const listCmd = graph
    .command("list")
    .summary("List all graphs")
    .description(`List all registered graph definitions.

Shows each graph name and its edge count.`);

  setCommandMeta(listCmd, {
    examples: [
      { description: "List all graphs", command: "dagman graph list" },
      { description: "List graphs as JSON", command: "dagman graph list --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success (even if no graphs exist)" },
    ],
    seeAlso: ["dagman-graph-show(1)", "dagman-graph-validate(1)"],
    dataProducing: true,
  });

  listCmd
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (options: { json?: boolean }) => {
        const graphs = await graphService.listGraphs();
        if (options.json) {
          outputJson({ graphs });
          return;
        }
        if (graphs.length === 0) {
          console.log("No graphs registered");
          return;
        }
        for (const g of graphs) {
          console.log(`  ${g.name} (${g.edges.length} edges)`);
        }
      })
    );

  const showCmd = graph
    .command("show")
    .summary("Show graph structure")
    .description(`Display the graph topology with optional task status overlay.

Shows each node with its dependency edges and, if a run is active,
the current task status and timestamps for each node.`);

  setCommandMeta(showCmd, {
    examples: [
      { description: "Show graph structure", command: "dagman graph show --graph pipeline" },
      { description: "Show with specific run status", command: "dagman graph show --graph pipeline --run abc123" },
      { description: "Show as JSON", command: "dagman graph show --graph pipeline --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success" },
      { code: 1, meaning: "Graph or run not found" },
    ],
    seeAlso: ["dagman-graph-list(1)", "dagman-graph-validate(1)", "dagman-run-show(1)"],
    dataProducing: true,
  });

  showCmd
    .requiredOption("--graph <name>", "graph name")
    .option("--run <runId>", "specify run")
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (options: { graph: string; run?: string; json?: boolean }) => {
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

        if (options.json) {
          outputJson({ graph: graphData, nodes, tasks });
          return;
        }

        console.log(
          graphService.formatGraph(nodes, graphData.edges, tasks, timestamps)
        );
      })
    );

  const validateCmd = graph
    .command("validate")
    .summary("Validate graph")
    .description(`Validate a graph definition for correctness.

Checks for: missing node definitions, orphan nodes (not connected
to any edge), and cycles in the dependency graph.`);

  setCommandMeta(validateCmd, {
    examples: [
      { description: "Validate a graph", command: "dagman graph validate --graph pipeline" },
      { description: "Validate as JSON", command: "dagman graph validate --graph pipeline --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Graph is valid (warnings may still exist)" },
      { code: 1, meaning: "Validation errors found" },
    ],
    seeAlso: ["dagman-graph-show(1)", "dagman-import(1)"],
    dataProducing: true,
  });

  validateCmd
    .requiredOption("--graph <name>", "graph name")
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (options: { graph: string; json?: boolean }) => {
        const graphData = await graphService.loadGraph(options.graph);
        const nodes = await nodeService.listNodes();
        const nodeNames = nodes.map((n) => n.name);
        const results = validatorService.validateGraph(nodeNames, graphData.edges);
        const errors = results.filter((r) => r.level === "error" && !r.passed);

        if (options.json) {
          const warnings = results.filter((r) => r.level === "warning");
          outputJson({
            valid: errors.length === 0,
            errors: errors.map((r) => ({ rule: r.rule, message: r.message })),
            warnings: warnings.map((r) => ({ rule: r.rule, message: r.message })),
          });
          if (errors.length > 0) {
            process.exit(1);
          }
          return;
        }

        console.log(validatorService.formatValidationResults(results));
        if (errors.length > 0) {
          process.exit(1);
        }
      })
    );
}
