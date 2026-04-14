import type { Command } from "commander";
import * as runService from "../services/run-service.js";
import * as graphService from "../services/graph-service.js";
import { RunNotFoundError, GraphNotFoundError } from "../errors.js";

export function registerRunCommand(program: Command): void {
  const run = program.command("run").description("管理运行实例");

  run
    .command("create [label]")
    .description("创建新的运行实例")
    .option("-s, --switch", "创建后自动切换到新运行", false)
    .option("--graph <name>", "绑定图")
    .action(
      async (
        label?: string,
        options?: { switch?: boolean; graph?: string }
      ) => {
        try {
          if (options?.graph) {
            if (!(await graphService.graphExists(options.graph))) {
              console.error(`错误: 图 '${options.graph}' 不存在`);
              process.exit(1);
            }
          }
          const info = await runService.createRun(
            label,
            options?.graph,
            options?.switch
          );
          console.log(
            `已创建运行: ${info.id}${info.label ? ` (${info.label})` : ""}`
          );
          if (info.graphName) {
            console.log(`绑定图: ${info.graphName}`);
          }
          if (options?.switch) {
            console.log(`已切换到运行: ${info.id}`);
          }
        } catch (err: unknown) {
          console.error(`错误: ${(err as Error).message}`);
          process.exit(1);
        }
      }
    );

  run
    .command("list")
    .description("列出所有运行实例")
    .action(async () => {
      try {
        const runs = await runService.listRuns();
        if (runs.length === 0) {
          console.log("暂无运行实例");
          return;
        }
        const currentRunId = await runService.getCurrentRunId();
        for (const r of runs) {
          const marker = r.id === currentRunId ? " *" : "";
          const graph = r.graphName ? ` [${r.graphName}]` : "";
          console.log(
            `  ${r.id}${r.label ? ` (${r.label})` : ""}${graph}${marker}`
          );
        }
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  run
    .command("switch <run-id>")
    .description("切换到指定运行实例")
    .action(async (runId: string) => {
      try {
        await runService.switchRun(runId);
        console.log(`已切换到运行: ${runId}`);
      } catch (err: unknown) {
        if (err instanceof RunNotFoundError) {
          console.error(`错误: 运行实例 '${runId}' 不存在`);
          process.exit(1);
        }
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  run
    .command("show [run-id]")
    .description("显示运行详情（默认当前运行）")
    .action(async (runId?: string) => {
      try {
        const rid = runId ?? (await runService.resolveCurrentRunId());
        const info = await runService.showRun(rid);
        console.log(`运行 ID: ${info.id}`);
        if (info.label) console.log(`标签: ${info.label}`);
        if (info.graphName) console.log(`绑定图: ${info.graphName}`);
        console.log(`创建时间: ${info.createdAt}`);
        console.log(`状态记录数: ${info.stateCount}`);
      } catch (err: unknown) {
        if (err instanceof RunNotFoundError) {
          console.error(`错误: 运行实例 '${runId}' 不存在`);
          process.exit(1);
        }
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
