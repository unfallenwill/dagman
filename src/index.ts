#!/usr/bin/env node

import { Command } from "commander";
import { registerHelpCommand } from "./commands/help.js";
import { registerNodeCommand } from "./commands/node.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerContextCommand } from "./commands/context.js";
import { registerGraphCommand } from "./commands/graph.js";
import { registerRunCommand } from "./commands/run.js";
import { registerNextCommand } from "./commands/next.js";
import { registerLogCommand } from "./commands/log.js";
import { registerImportCommand } from "./commands/import.js";
import { registerExportCommand } from "./commands/export.js";

process.on("uncaughtException", (err: Error) => {
  console.error(`错误: ${err.message}`);
  process.exit(1);
});

const program = new Command();
program.name("dagman");

registerHelpCommand(program);
registerNodeCommand(program);
registerStatusCommand(program);
registerContextCommand(program);
registerGraphCommand(program);
registerRunCommand(program);
registerNextCommand(program);
registerLogCommand(program);
registerImportCommand(program);
registerExportCommand(program);

program.parse();
