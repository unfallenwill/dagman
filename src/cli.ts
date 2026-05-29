import { Command } from "commander";
import { registerHelpCommand } from "./commands/help.js";
import { registerNodeCommand } from "./commands/node.js";
import { registerGraphCommand } from "./commands/graph.js";
import { registerRunCommand } from "./commands/run.js";
import { registerNextCommand } from "./commands/next.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerChannelCommand } from "./commands/channel.js";
import { registerStepCommand } from "./commands/step.js";
import { registerLogCommand } from "./commands/log.js";
import { registerImportCommand } from "./commands/import.js";
import { registerExportCommand } from "./commands/export.js";

export function run(): void {
  const program = new Command();
  program.name("dagman");

  registerHelpCommand(program);
  registerNodeCommand(program);
  registerGraphCommand(program);
  registerRunCommand(program);
  registerNextCommand(program);
  registerTaskCommand(program);
  registerChannelCommand(program);
  registerStepCommand(program);
  registerLogCommand(program);
  registerImportCommand(program);
  registerExportCommand(program);

  program.parse();
}
