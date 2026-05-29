import type { Command } from "commander";
import * as workflowService from "../workflow/workflow.js";
import { NodeNotFoundError, CliError } from "../errors.js";
import { GLOBAL_CHANNEL_PREFIX } from "../models/channel.js";
import { setCommandMeta } from "../utils/command-meta.js";
import { withErrorHandler, outputJson } from "../utils/output.js";

export function registerChannelCommand(program: Command): void {
  const channel = program
    .command("channel")
    .summary("Channel management")
    .description(`Manage channels — the versioned key-value store for node data.

Channels carry data between nodes during execution. Each channel has
a value and an auto-incrementing version number.

Channel naming:
  Node output    {node}.{key}     — Node execution output
  Edge signal    edge:{from}->{to} — Dependency satisfaction signal
  Global         _global.{key}    — Shared across all nodes`);

  setCommandMeta(channel, {
    examples: [
      { description: "List channels for current run", command: "dagman channel list" },
      { description: "Get a channel value", command: "dagman channel get build output" },
      { description: "Set a channel value", command: "dagman channel set build output 'success'" },
      { description: "Set a global channel", command: 'dagman channel set . config \'{"key":"val"}\' --global' },
      { description: "Clear all channels for a node", command: "dagman channel clear build" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success" },
      { code: 1, meaning: "Error (channel not found, node not found)" },
    ],
    seeAlso: ["dagman-task(1)", "dagman-step(1)", "dagman-next(1)"],
    dataProducing: false,
  });

  // --- channel list ---
  const listCmd = channel
    .command("list [node]")
    .summary("List channels")
    .description(`List channels for a specific node, global channels, or all channels.

Use --global to list global channels. Without a node argument, lists
all channels in the current run.`);

  setCommandMeta(listCmd, {
    examples: [
      { description: "List all channels", command: "dagman channel list" },
      { description: "List channels for a node", command: "dagman channel list build" },
      { description: "List global channels", command: "dagman channel list --global" },
      { description: "List as JSON", command: "dagman channel list --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success (even if no channels found)" },
    ],
    seeAlso: ["dagman-channel-get(1)", "dagman-channel-set(1)"],
    dataProducing: true,
  });

  listCmd
    .option("--global", "list global channels")
    .option("-r, --run <runId>", "specify run")
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (node: string | undefined, options: { global?: boolean; run?: string; json?: boolean }) => {
        let target = node;
        if (options.global) target = GLOBAL_CHANNEL_PREFIX;

        const channels = await workflowService.listChannels(target, options.run);

        if (options.json) {
          outputJson({ channels });
          return;
        }

        if (channels.length === 0) {
          console.log(target ? "No channels found" : "No channel data");
          return;
        }
        for (const ch of channels) {
          console.log(`  ${ch.name}: ${ch.value} (v${ch.version})`);
        }
      })
    );

  // --- channel get ---
  const getCmd = channel
    .command("get <node> <key>")
    .summary("Get channel value")
    .description(`Read the value and version of a specific channel.

Use --global to read a global channel (the node parameter is ignored).`);

  setCommandMeta(getCmd, {
    examples: [
      { description: "Get a node channel", command: "dagman channel get build output" },
      { description: "Get a global channel", command: "dagman channel get . config --global" },
      { description: "Get as JSON", command: "dagman channel get build output --json" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success" },
      { code: 1, meaning: "Channel does not exist or run not found" },
    ],
    seeAlso: ["dagman-channel-set(1)", "dagman-channel-list(1)"],
    dataProducing: true,
  });

  getCmd
    .option("--global", "read global channel (node parameter is ignored)")
    .option("-r, --run <runId>", "specify run")
    .option("--json", "output in JSON format")
    .action(
      withErrorHandler(async (node: string, key: string, options: { global?: boolean; run?: string; json?: boolean }) => {
        const channelName = options.global
          ? `_global.${key}`
          : `${node}.${key}`;
        const ch = await workflowService.getChannel(channelName, options.run);
        if (!ch || ch.version === 0) {
          const scope = options.global ? "Global" : `Node '${node}' `;
          throw new CliError(`${scope}channel '${key}' does not exist`);
        }

        if (options.json) {
          outputJson(ch);
          return;
        }

        console.log(`${ch.value} (v${ch.version})`);
      })
    );

  // --- channel set ---
  const setCmd = channel
    .command("set <node> <key> <value>")
    .summary("Set channel value (version increments)")
    .description(`Write a value to a channel. The version auto-increments on each write.

Use --global to write a global channel (the node parameter is ignored).`);

  setCommandMeta(setCmd, {
    examples: [
      { description: "Set a node channel", command: "dagman channel set build output 'success'" },
      { description: "Set a global channel", command: 'dagman channel set . api_url "https://example.com" --global' },
    ],
    exitStatus: [
      { code: 0, meaning: "Channel set successfully" },
      { code: 1, meaning: "Node not found or run not found" },
    ],
    seeAlso: ["dagman-channel-get(1)", "dagman-channel-list(1)", "dagman-channel-clear(1)"],
    dataProducing: false,
  });

  setCmd
    .option("--global", "write global channel (node parameter is ignored)")
    .option("-r, --run <runId>", "specify run")
    .action(
      withErrorHandler(async (node: string, key: string, value: string, options: { global?: boolean; run?: string }) => {
        const channelName = options.global
          ? `_global.${key}`
          : `${node}.${key}`;

        const ch = await workflowService.setChannel(channelName, value, options.run);
        const scope = options.global ? "global " : `node '${node}' `;
        console.log(`Set ${scope}channel: ${key} = ${value} (v${ch.version})`);
      })
    );

  // --- channel clear ---
  const clearCmd = channel
    .command("clear <node>")
    .summary("Clear all channels for a node")
    .description(`Remove all channel data associated with a specific node.`);

  setCommandMeta(clearCmd, {
    examples: [
      { description: "Clear channels for a node", command: "dagman channel clear build" },
    ],
    exitStatus: [
      { code: 0, meaning: "Channels cleared" },
      { code: 1, meaning: "Run not found" },
    ],
    seeAlso: ["dagman-channel-list(1)", "dagman-channel-set(1)"],
    dataProducing: false,
  });

  clearCmd
    .option("-r, --run <runId>", "specify run")
    .action(
      withErrorHandler(async (node: string, options: { run?: string }) => {
        await workflowService.clearChannels(node, options.run);
        console.log(`Cleared all channels for node '${node}'`);
      })
    );
}
