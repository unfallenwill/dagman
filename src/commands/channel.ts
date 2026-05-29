import type { Command } from "commander";
import * as workflowService from "../services/workflow-service.js";
import * as nodeService from "../services/node-service.js";
import { NodeNotFoundError } from "../errors.js";
import { GLOBAL_CHANNEL_PREFIX } from "../models/channel.js";

export function registerChannelCommand(program: Command): void {
  const channel = program.command("channel").description("Channel 管理");

  channel
    .command("list [node]")
    .description("列出 channels")
    .option("--global", "列出全局 channels")
    .option("-r, --run <runId>", "指定运行实例")
    .action(async (node: string | undefined, options: { global?: boolean; run?: string }) => {
      try {
        let target = node;
        if (options.global) target = GLOBAL_CHANNEL_PREFIX;

        const channels = await workflowService.listChannels(target, options.run);
        if (channels.length === 0) {
          console.log(target ? `暂无 channels` : "暂无 channel 数据");
          return;
        }
        for (const ch of channels) {
          console.log(`  ${ch.name}: ${ch.value} (v${ch.version})`);
        }
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  channel
    .command("get <node> <key>")
    .description("读取 channel 值")
    .option("--global", "读取全局 channel（node 参数将被忽略）")
    .option("-r, --run <runId>", "指定运行实例")
    .action(async (node: string, key: string, options: { global?: boolean; run?: string }) => {
      try {
        const channelName = options.global
          ? `_global.${key}`
          : `${node}.${key}`;
        const ch = await workflowService.getChannel(channelName, options.run);
        if (!ch || ch.version === 0) {
          const scope = options.global ? "全局" : `节点 '${node}'`;
          console.error(`错误: ${scope}channel '${key}' 不存在`);
          process.exit(1);
        }
        console.log(`${ch.value} (v${ch.version})`);
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  channel
    .command("set <node> <key> <value>")
    .description("写入 channel（version 递增）")
    .option("--global", "写入全局 channel（node 参数将被忽略）")
    .option("-r, --run <runId>", "指定运行实例")
    .action(async (node: string, key: string, value: string, options: { global?: boolean; run?: string }) => {
      try {
        if (!options.global) {
          await nodeService.getNode(node);
        }

        const channelName = options.global
          ? `_global.${key}`
          : `${node}.${key}`;
        const ch = await workflowService.setChannel(channelName, value, options.run);
        const scope = options.global ? "全局" : `节点 '${node}' `;
        console.log(`已设置${scope}channel: ${key} = ${value} (v${ch.version})`);
      } catch (err: unknown) {
        if (err instanceof NodeNotFoundError) {
          console.error(`错误: 节点 '${node}' 不存在`);
          process.exit(1);
        }
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  channel
    .command("clear <node>")
    .description("清除节点的所有 channels")
    .option("-r, --run <runId>", "指定运行实例")
    .action(async (node: string, options: { run?: string }) => {
      try {
        await workflowService.clearChannels(node, options.run);
        console.log(`已清除节点 '${node}' 的所有 channels`);
      } catch (err: unknown) {
        console.error(`错误: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
