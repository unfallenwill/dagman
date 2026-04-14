import type { Command } from "commander";
import * as graphService from "../services/graph-service.js";
import * as validatorService from "../services/validator.js";

export function registerGraphCommand(program: Command): void {
  const graph = program.command("graph").description("任务图操作");

  graph
    .command("show")
    .description("展示完整任务图")
    .action(async () => {
      try {
        const { nodes, states } = await graphService.buildGraph();
        console.log(graphService.formatGraph(nodes, states));
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  graph
    .command("validator")
    .description("校验任务图合法性")
    .action(async () => {
      try {
        const results = await validatorService.validateGraph();
        console.log(validatorService.formatValidationResults(results));
        if (results.some((r) => r.level === "error" && !r.passed)) {
          process.exit(1);
        }
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
