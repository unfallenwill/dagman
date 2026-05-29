import { Command } from "commander";
import { registerHelpCommand } from "./commands/help.js";
import { registerNextCommand } from "./commands/next.js";
import { registerLogCommand } from "./commands/log.js";
import { registerWorkflowCommand } from "./commands/workflow.js";
import { registerCollectCommand } from "./commands/collect.js";
import { getCommandMeta } from "./utils/command-meta.js";
import { formatManHelp } from "./utils/format-help.js";

export function run(): void {
  const program = new Command();
  program.name("dagman");

  program.configureHelp({
    sortSubcommands: true,
    sortOptions: true,
  });

  registerHelpCommand(program);
  registerWorkflowCommand(program);
  registerNextCommand(program);
  registerCollectCommand(program);
  registerLogCommand(program);

  // Attach man page style after-help to all commands that have metadata
  for (const cmd of program.commands) {
    attachHelpText(cmd);
  }

  program.parse();
}

function attachHelpText(cmd: Command): void {
  // If this command has subcommands, recurse
  if (cmd.commands && cmd.commands.length > 0) {
    for (const sub of cmd.commands) {
      attachHelpText(sub);
    }
  }
  // Attach man page after-text if metadata exists
  const meta = getCommandMeta(cmd);
  if (meta) {
    cmd.addHelpText("after", formatManHelp(cmd));
  }
}
