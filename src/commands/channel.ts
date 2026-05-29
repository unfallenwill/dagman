import type { Command } from "commander";
import * as workflowService from "../workflow/workflow.js";
import * as nodeService from "../graph/node.js";
import { NodeNotFoundError } from "../errors.js";
import { GLOBAL_CHANNEL_PREFIX } from "../models/channel.js";

export function registerChannelCommand(program: Command): void {
  const channel = program.command("channel").description("Channel management");

  channel
    .command("list [node]")
    .description("List channels")
    .option("--global", "list global channels")
    .option("-r, --run <runId>", "specify run")
    .action(async (node: string | undefined, options: { global?: boolean; run?: string }) => {
      try {
        let target = node;
        if (options.global) target = GLOBAL_CHANNEL_PREFIX;

        const channels = await workflowService.listChannels(target, options.run);
        if (channels.length === 0) {
          console.log(target ? `No channels found` : "No channel data");
          return;
        }
        for (const ch of channels) {
          console.log(`  ${ch.name}: ${ch.value} (v${ch.version})`);
        }
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  channel
    .command("get <node> <key>")
    .description("Get channel value")
    .option("--global", "read global channel (node parameter is ignored)")
    .option("-r, --run <runId>", "specify run")
    .action(async (node: string, key: string, options: { global?: boolean; run?: string }) => {
      try {
        const channelName = options.global
          ? `_global.${key}`
          : `${node}.${key}`;
        const ch = await workflowService.getChannel(channelName, options.run);
        if (!ch || ch.version === 0) {
          const scope = options.global ? "Global" : `Node '${node}' `;
          console.error(`Error: ${scope}channel '${key}' does not exist`);
          process.exit(1);
        }
        console.log(`${ch.value} (v${ch.version})`);
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  channel
    .command("set <node> <key> <value>")
    .description("Set channel value (version increments)")
    .option("--global", "write global channel (node parameter is ignored)")
    .option("-r, --run <runId>", "specify run")
    .action(async (node: string, key: string, value: string, options: { global?: boolean; run?: string }) => {
      try {
        if (!options.global) {
          await nodeService.getNode(node);
        }

        const channelName = options.global
          ? `_global.${key}`
          : `${node}.${key}`;
        const ch = await workflowService.setChannel(channelName, value, options.run);
        const scope = options.global ? "global " : `node '${node}' `;
        console.log(`Set ${scope}channel: ${key} = ${value} (v${ch.version})`);
      } catch (err: unknown) {
        if (err instanceof NodeNotFoundError) {
          console.error(`Error: Node '${node}' does not exist`);
          process.exit(1);
        }
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  channel
    .command("clear <node>")
    .description("Clear all channels for a node")
    .option("-r, --run <runId>", "specify run")
    .action(async (node: string, options: { run?: string }) => {
      try {
        await workflowService.clearChannels(node, options.run);
        console.log(`Cleared all channels for node '${node}'`);
      } catch (err: unknown) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
