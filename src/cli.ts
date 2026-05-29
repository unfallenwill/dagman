import { Command } from "commander";
import { registerHelpCommand } from "./commands/help.js";
import { registerNextCommand } from "./commands/next.js";
import { registerLogCommand } from "./commands/log.js";
import { registerCollectCommand } from "./commands/collect.js";
import { registerLsCommand } from "./commands/ls.js";
import { registerGraphCommand } from "./commands/graph.js";
import { registerStartCommand } from "./commands/start.js";
import { registerPsCommand } from "./commands/ps.js";
import { registerShowCommand } from "./commands/show.js";
import { registerCompileCommand } from "./commands/compile.js";
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
  registerLsCommand(program);
  registerGraphCommand(program);
  registerStartCommand(program);
  registerPsCommand(program);
  registerShowCommand(program);
  registerCompileCommand(program);
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
  const meta = getCommandMeta(cmd);
  if (meta) {
    cmd.addHelpText("after", formatManHelp(cmd));
  }
}
