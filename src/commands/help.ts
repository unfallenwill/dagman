import type { Command } from "commander";
import { readFileSync } from "fs";
import * as path from "path";
import { CliError } from "../errors.js";

function getVersion(): string {
  try {
    // Search upward from script directory for package.json (dist/commands/help.js -> package.json)
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    // Fallback to cwd
    try {
      const pkgPath = path.resolve("package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      return pkg.version ?? "0.0.0";
    } catch {
      return "0.0.0";
    }
  }
}

/** Static overview content — concepts, workflow, YAML format, edge semantics, variables. */
function buildOverview(version: string): string {
  return `dagman v${version} — DAG-based agent task orchestration CLI

━━━ Overview ━━━

dagman is a task scheduler based on directed acyclic graphs (DAGs). It does not
execute tasks itself, but tells an external agent what to do next via \`dagman next\`.

Core execution loop:
  import -> run create -> loop { next -> task start -> execute -> task complete } -> done

━━━ Core Concepts ━━━

Node      Static task definition (name, description, instructions), no runtime state
Graph     DAG topology, declares dependencies between nodes via an edges list
Run       Execution instance of a graph, \`run create --graph <name>\` auto-computes topological layers
Task      Runtime entity, created from a Node, lifecycle: ready -> running -> success / failed / skipped
Superstep BFS-layered execution, all ready tasks within a layer can run in parallel, advance when all reach terminal state
Channel   Versioned key-value store for passing data between nodes:
            Node output {node}.{key}    Edge signal edge:{from}->{to}    Global _global.{key}

━━━ Workflow ━━━

1. Write YAML definition files (see format below)
2. dagman import plan.yaml                # Import node and graph definitions
3. dagman run create --graph <name> -s    # Create a run and switch to it
4. dagman next                            # Get the next executable task
5. dagman task start <node>               # Mark task as running
6. (agent performs the actual work)
7. dagman channel set <node> <key> <val>  # Store output (optional)
8. dagman task complete <node>            # Mark task as completed
9. Go back to step 4, repeat until "No executable tasks"

━━━ YAML Import Format ━━━

Separate multiple documents with \`---\`, can mix Node and Graph:

  kind: Node
  name: setup
  description: Initialize project environment
  instructions: Install dependencies and create config files
  ---
  kind: Node
  name: build
  description: Build
  instructions: Run build command
  ---
  kind: Graph
  name: pipeline
  edges:
    - from: build
      to: setup

━━━ Edge Semantics ━━━

Edge { from, to } means from depends on to (to executes first).
expect defaults to "success"; when expect is "success", a "skipped" status on the to node also satisfies the dependency.

━━━ Variable References ━━━

Node instructions support Handlebars templates to reference upstream outputs:
  {{key}}              Current node's own channel
  {{node-name.key}}    Upstream node channel (dependencies validated at import time)
  {{global.key}}       Global channel

━━━ More Help ━━━

  dagman <command> --help    Show subcommand usage
`;
}

/** Dynamic command reference — generated from registered Commander commands. */
function buildCommandReference(program: Command): string {
  const groups: Record<string, Array<{ usage: string; summary: string }>> = {};

  // Categorize commands into groups
  const definitionCommands = ["node", "graph"];
  const executionCommands = ["import", "export", "run"];
  const schedulingCommands = ["next", "task"];

  for (const cmd of program.commands) {
    const cmdName = cmd.name();
    if (cmdName === "help") continue;

    let category: string;
    if (definitionCommands.includes(cmdName)) {
      category = "Definitions";
    } else if (executionCommands.includes(cmdName)) {
      category = "Execution";
    } else if (schedulingCommands.includes(cmdName)) {
      category = "Scheduling (core)";
    } else {
      category = "Data";
    }

    if (!groups[category]) {
      groups[category] = [];
    }

    if (cmd.commands && cmd.commands.length > 0) {
      // Command group with subcommands
      for (const sub of cmd.commands) {
        const args = sub.usage().replace(sub.name(), "").trim();
        const usage = `${cmdName} ${sub.name()}${args ? " " + args : ""}`;
        const summary = sub.summary() || sub.description().split("\n")[0];
        groups[category].push({ usage: usage.padEnd(32), summary });
      }
    } else {
      // Top-level command
      const args = cmd.usage().replace(cmdName, "").trim();
      const usage = `${cmdName}${args ? " " + args : ""}`;
      const summary = cmd.summary() || cmd.description().split("\n")[0];
      groups[category].push({ usage: usage.padEnd(32), summary });
    }
  }

  const categoryOrder = ["Definitions", "Execution", "Scheduling (core)", "Data"];
  const lines: string[] = ["━━━ Command Reference ━━━\n"];

  for (const category of categoryOrder) {
    const items = groups[category];
    if (!items || items.length === 0) continue;
    lines.push(`${category}:`);
    for (const item of items) {
      lines.push(`  ${item.usage}${item.summary}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function registerHelpCommand(program: Command): void {
  program.description("DAG-based agent task orchestration CLI").version(getVersion());

  program
    .command("help [subcommand]")
    .summary("Show usage guide or subcommand help")
    .description(`Show the full usage guide, or detailed help for a specific subcommand.

Without arguments, displays the complete guide including core concepts,
workflow, YAML format, and command reference.
With a subcommand name, shows man page style help for that command.`)
    .action((subcommand?: string) => {
      if (subcommand) {
        const cmd = program.commands.find((c) => c.name() === subcommand);
        if (cmd) {
          cmd.outputHelp();
        } else {
          throw new CliError(`Unknown command: ${subcommand}`);
        }
      } else {
        console.log(buildOverview(getVersion()));
        console.log(buildCommandReference(program));
      }
    });
}
