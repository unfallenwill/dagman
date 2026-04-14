#!/usr/bin/env node

import { Command } from "commander";
import { registerHelpCommand } from "./commands/help.js";
import { registerCreateCommand } from "./commands/create.js";
import { registerAddCommand } from "./commands/add.js";
import { registerRemoveCommand } from "./commands/remove.js";
import { registerChangeCommand } from "./commands/change.js";
import { registerContextCommand } from "./commands/context.js";
import { registerGraphCommand } from "./commands/graph.js";
import { registerRunCommand } from "./commands/run.js";
import { registerNextCommand } from "./commands/next.js";
import { registerLogCommand } from "./commands/log.js";

process.on("uncaughtException", (err: Error) => {
  console.error(`错误: ${err.message}`);
  process.exit(1);
});

const program = new Command();
program.name("dagman");

registerHelpCommand(program);
registerCreateCommand(program);
registerAddCommand(program);
registerRemoveCommand(program);
registerChangeCommand(program);
registerContextCommand(program);
registerGraphCommand(program);
registerRunCommand(program);
registerNextCommand(program);
registerLogCommand(program);

program.parse();
