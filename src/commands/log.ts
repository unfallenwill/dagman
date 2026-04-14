import type { Command } from "commander";
import * as eventService from "../services/event-service.js";
import { resolveCurrentRunId } from "../services/run-service.js";
import { RunNotFoundError } from "../errors.js";
import { getRunMetaFile } from "../constants.js";
import { fileExists } from "../utils/file.js";

function formatEvent(iso: string, node: string, from: string, to: string): string {
  return `[${iso}] ${node}: ${from} -> ${to}`;
}

export function registerLogCommand(program: Command): void {
  program
    .command("log [node]")
    .description("查看执行日志")
    .option("--run <runId>", "指定运行实例")
    .action(async (node?: string, options?: { run?: string }) => {
      try {
        const runId = options?.run ?? (await resolveCurrentRunId());
        const metaFile = getRunMetaFile(runId);
        if (!(await fileExists(metaFile))) {
          throw new RunNotFoundError(runId);
        }

        const events = await eventService.readEvents(runId);
        const filtered = node
          ? events.filter((e) => e.node === node)
          : events;

        if (filtered.length === 0) {
          console.log(node ? `节点 '${node}' 暂无执行记录` : "暂无执行记录");
          return;
        }

        for (const e of filtered) {
          console.log(formatEvent(e.timestamp, e.node, e.from, e.to));
        }
      } catch (err: unknown) {
        if (err instanceof RunNotFoundError) {
          console.error(`错误: 运行实例 '${options?.run}' 不存在`);
          process.exit(1);
        }
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
