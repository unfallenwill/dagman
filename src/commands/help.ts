import type { Command } from "commander";

export function registerHelpCommand(program: Command): void {
  program.description("dagman - 通用 agent 任务编排 CLI 工具").version("0.1.0");
}
