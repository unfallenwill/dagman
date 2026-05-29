import type { Command } from "commander";
import * as nodeService from "../services/node-service.js";
import * as graphService from "../services/graph-service.js";
import { confirmPrompt } from "../utils/prompt.js";
import { collectDownstream } from "../utils/topology.js";
import { FileExistsError, NodeNotFoundError } from "../errors.js";

const NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

export function registerNodeCommand(program: Command): void {
  const node = program.command("node").description("Node management");

  node
    .command("create <name>")
    .description("Create a node template")
    .action(async (name: string) => {
      try {
        if (!NAME_REGEX.test(name) || name.length < 1 || name.length > 100) {
          console.error(
            "Error: Node name must contain only letters, digits, hyphens and underscores, length 1-100"
          );
          process.exit(1);
        }

        const filePath = await nodeService.createTemplate(name);
        console.log(`Node template created: ${filePath}`);
      } catch (err: unknown) {
        if (err instanceof FileExistsError) {
          console.error(
            `Error: Node '${name}' already exists, remove it first with node remove`
          );
          process.exit(1);
        }
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  node
    .command("list")
    .description("List all nodes")
    .action(async () => {
      try {
        const nodes = await nodeService.listNodes();
        if (nodes.length === 0) {
          console.log("No nodes registered");
          return;
        }
        for (const n of nodes) {
          console.log(`  ${n.name}`);
        }
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  node
    .command("remove <name>")
    .description("Remove a node")
    .option("--force", "skip confirmation prompt")
    .action(async (name: string, options: { force?: boolean }) => {
      try {
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

        await nodeService.removeNode(name);
        console.log(`Node removed: ${name}`);
      } catch (err: unknown) {
        if (err instanceof NodeNotFoundError) {
          console.error(`Error: Node '${name}' does not exist`);
          process.exit(1);
        }
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
