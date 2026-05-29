import type { Command } from "commander";
import * as graphService from "../services/graph-service.js";
import * as validatorService from "../services/validator.js";
import * as nodeService from "./../services/node-service.js";

export function registerGraphCommand(program: Command): void {
  const graph = program.command("graph").description("任务图操作");

  graph
    .command("list")
    .description("列出所有图")
    .action(async () => {
      try {
        const graphs = await graphService.listGraphs();
        if (graphs.length === 0) {
          console.log("暂无已注册图");
          return;
        }
        for (const g of graphs) {
          console.log(`  ${g.name} (${g.edges.length} 条边)`);
        }
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  graph
    .command("show")
    .description("展示完整任务图")
    .requiredOption("--graph <name>", "指定图名称")
    .option("--run <runId>", "指定运行实例")
    .action(async (options: { graph: string; run?: string }) => {
      try {
        const { nodes, edges, tasks, timestamps } = await graphService.buildGraph(
          options.graph,
          options.run
        );
        console.log(graphService.formatGraph(nodes, edges, tasks, timestamps));
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  graph
    .command("validate")
    .description("校验任务图合法性")
    .requiredOption("--graph <name>", "指定图名称")
    .action(async (options: { graph: string }) => {
      try {
        const graph = await graphService.loadGraph(options.graph);
        const nodes = await nodeService.listNodes();
        const nodeNames = nodes.map((n) => n.name);
        const results = validatorService.validateGraph(nodeNames, graph.edges);
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
