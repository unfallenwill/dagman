import type { Command } from "commander";
import * as nodeService from "../graph/node.js";
import * as graphService from "../graph/graph.js";
import * as workflowService from "../workflow/workflow.js";
import { confirmPrompt } from "../utils/prompt.js";
import { collectDownstream } from "../utils/topology.js";
import { listRunIds } from "../utils/run-resolver.js";
import { FileExistsError, NodeNotFoundError, CliError } from "../errors.js";
import { setCommandMeta } from "../utils/command-meta.js";
import { withErrorHandler, outputJson } from "../utils/output.js";

const NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

function assertValidName(name: string): void {
  if (!NAME_REGEX.test(name) || name.length < 1 || name.length > 100) {
    throw new CliError(
      "Node name must contain only letters, digits, hyphens and underscores, length 1-100"
    );
  }
}

export function registerNodeCommand(program: Command): void {
  const node = program
    .command("node")
    .summary("Node management")
    .description(`Manage node templates.

Nodes are static task definitions containing a name, description, and
instructions. They carry no runtime state. Nodes are the building blocks
of graphs and are stored as YAML files in .dagman/nodes/.`);

  setCommandMeta(node, {
    examples: [
      { description: "Create a new node template", command: "dagman node create build" },
      { description: "List all registered nodes", command: "dagman node list" },
      { description: "List nodes in JSON format", command: "dagman node list --json" },
      { description: "Remove a node", command: "dagman node remove old-task" },
      { description: "Remove without confirmation", command: "dagman node remove old-task --force" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success" },
      { code: 1, meaning: "Error (node not found, invalid name, file system error)" },
    ],
    seeAlso: ["dagman-graph(1)", "dagman-import(1)", "dagman-export(1)"],
    dataProducing: false,
  });

  const createCmd = node
    .command("create <name>")
    .summary("Create a node template")
    .description(`Create a new node definition file in .dagman/nodes/<name>.yaml.

The name must contain only letters, digits, hyphens, and underscores
(1-100 characters). The template is created with empty description and
instructions for you to edit.`);

  setCommandMeta(createCmd, {
    examples: [
      { description: "Create a node named 'build'", command: "dagman node create build" },
    ],
    exitStatus: [
      { code: 0, meaning: "Node created successfully" },
      { code: 1, meaning: "Invalid name or node already exists" },
    ],
    seeAlso: ["dagman-node-list(1)", "dagman-node-remove(1)"],
    dataProducing: false,
  });

  createCmd.action(
    withErrorHandler(async (name: string) => {
      assertValidName(name);
      try {
        const filePath = await nodeService.createTemplate(name);
        console.log(`Node template created: ${filePath}`);
      } catch (err: unknown) {
        if (err instanceof FileExistsError) {
          throw new CliError(`Node '${name}' already exists, remove it first with node remove`);
        }
        throw err;
      }
    })
  );

  const listCmd = node
    .command("list")
    .summary("List all nodes")
    .description(`List all registered node definitions.

Shows the name of each node stored in .dagman/nodes/.`);

  setCommandMeta(listCmd, {
    examples: [
      { description: "List all nodes", command: "dagman node list" },
      { description: "List nodes as JSON", command: "dagman node list --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success (even if no nodes exist)" },
    ],
    seeAlso: ["dagman-node-create(1)", "dagman-graph-list(1)"],
    dataProducing: true,
  });

  listCmd
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (options: { json?: boolean }) => {
        const nodes = await nodeService.listNodes();
        if (options.json) {
          outputJson({ nodes });
          return;
        }
        if (nodes.length === 0) {
          console.log("No nodes registered");
          return;
        }
        for (const n of nodes) {
          console.log(`  ${n.name}`);
        }
      })
    );

  const removeCmd = node
    .command("remove <name>")
    .summary("Remove a node")
    .description(`Remove a node definition and clean up its channels across all runs.

Warns if other nodes depend on the node being removed. Use --force to
skip the confirmation prompt.`);

  setCommandMeta(removeCmd, {
    examples: [
      { description: "Remove a node", command: "dagman node remove old-task" },
      { description: "Remove without confirmation", command: "dagman node remove old-task --force" },
    ],
    exitStatus: [
      { code: 0, meaning: "Node removed successfully" },
      { code: 1, meaning: "Node not found or file system error" },
    ],
    seeAlso: ["dagman-node-create(1)", "dagman-node-list(1)"],
    dataProducing: false,
  });

  removeCmd
    .option("--force", "skip confirmation prompt")
    .action(
      withErrorHandler(async (name: string, options: { force?: boolean }) => {
        // Check if any graph has edges referencing this node
        const graphs = await graphService.listGraphs();
        const allEdges = graphs.flatMap((g) => g.edges);
        const dependents = collectDownstream(name, allEdges);

        if (dependents.length > 0) {
          console.log(
            `Warning: The following nodes depend on '${name}': ${dependents.join(", ")}`
          );
          if (!options.force) {
            const confirmed = await confirmPrompt("Are you sure you want to continue?");
            if (!confirmed) {
              console.log("Removal cancelled");
              return;
            }
          }
        }

        try {
          await nodeService.removeNode(name);
        } catch (err: unknown) {
          if (err instanceof NodeNotFoundError) {
            throw new CliError(`Node '${name}' does not exist`);
          }
          throw err;
        }

        // Clean up channels for this node across all runs
        const runIds = await listRunIds();
        for (const rid of runIds) {
          try {
            await workflowService.clearChannels(name, rid);
          } catch {
            // Ignore if workflow is not initialized
          }
        }

        console.log(`Node removed: ${name}`);
      })
    );
}
