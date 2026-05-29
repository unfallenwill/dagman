import type { Command } from "commander";
import * as fs from "fs/promises";
import * as path from "path";
import { withErrorHandler, outputJson } from "../utils/output.js";
import { setCommandMeta } from "../utils/command-meta.js";
import * as nodeService from "../graph/node.js";
import * as runService from "../runtime/run.js";
import * as graphService from "../graph/graph.js";
import * as workflowService from "../workflow/workflow.js";
import { stateChannelName } from "../models/channel.js";
import { ValidationError } from "../errors.js";
import { buildGraphState } from "../utils/state.js";

export function registerCollectCommand(program: Command): void {
  const collectCmd = program
    .command("collect")
    .summary("Collect results for a workflow node")
    .description(`Collect and validate results for a node that has a stateKey.

This command is used by the agent to submit results after a node
execution. It validates the result against the state schema, writes
the value to the appropriate state channel, and marks the collect
task as complete.

Usage: dagman collect <node-id> -f <result.json>`);

  setCommandMeta(collectCmd, {
    examples: [
      { description: "Collect result from a JSON file", command: "dagman collect classify -f result.json" },
      { description: "Collect result with inline value", command: "dagman collect classify --value '{\"intent\":\"need_tool'}'" },
      { description: "Collect result for a specific run", command: "dagman collect classify -f result.json --run abc123" },
    ],
    exitStatus: [
      { code: 0, meaning: "Success (result collected and validated)" },
      { code: 1, meaning: "Error (validation failed, task not found, etc.)" },
    ],
    seeAlso: ["dagman-next(1)", "dagman-task(1)", "dagman-channel(1)"],
    dataProducing: true,
  });

  collectCmd
    .argument("<node-id>", "the node to collect results for")
    .option("-f, --file <path>", "JSON file containing the result")
    .option("--value <json>", "inline JSON value for the result")
    .option("-r, --run <run-id>", "specify run (defaults to current)")
    .option("--json", "output result as JSON")
    .action(
      withErrorHandler(async (nodeId: string, options: {
        file?: string;
        value?: string;
        run?: string;
        json?: boolean;
      }) => {
        const rid = await runService.resolveRunId(options.run);

        // 1. Load the node definition
        const node = await nodeService.getNode(nodeId);
        if (!node.stateKey) {
          throw new ValidationError(
            `node '${nodeId}' does not have a stateKey, nothing to collect`
          );
        }

        // 2. Load the collect task
        const collectName = `collect-${nodeId}`;
        const state = await workflowService.loadState(rid);
        const collectTask = state.currentRecord.tasks.find(
          (t) => t.nodeId === collectName
        );
        if (!collectTask) {
          throw new ValidationError(
            `collect task '${collectName}' not found in current superstep`
          );
        }
        if (collectTask.status !== "ready") {
          throw new ValidationError(
            `collect task '${collectName}' is '${collectTask.status}', cannot collect (expected 'ready')`
          );
        }

        // 3. Read result value
        let resultValue: unknown;
        if (options.file) {
          const absPath = path.resolve(options.file);
          const content = await fs.readFile(absPath, "utf-8");
          resultValue = JSON.parse(content);
        } else if (options.value) {
          resultValue = JSON.parse(options.value);
        } else {
          throw new ValidationError("must provide --file <path> or --value <json>");
        }

        // 4. Write to state channel: _state.<stateKey> = resultValue
        const channelName = stateChannelName(node.stateKey);
        await workflowService.startTask(collectName, rid);
        await workflowService.setChannel(channelName, resultValue, rid);

        // 5. Complete the collect task
        const graphName = await runService.getGraphForRun(rid);
        let edges: import("../models/graph.js").Edge[] = [];
        if (graphName) {
          let graph;
          try {
            graph = await graphService.loadCompiledGraph(graphName);
          } catch {
            graph = await graphService.loadGraph(graphName);
          }
          edges = graph.edges;
        }
        await workflowService.completeTask(collectName, edges, rid);

        if (options.json) {
          outputJson({
            nodeId,
            stateKey: node.stateKey,
            channel: channelName,
            value: resultValue,
            collectTask: collectName,
            status: "success",
          });
        } else {
          console.log(`Collected '${node.stateKey}' for ${nodeId}`);
          console.log(`  Channel: ${channelName}`);
          console.log(`  Value: ${JSON.stringify(resultValue)}`);
          console.log(`  Task: ${collectName} → success`);
        }
      })
    );
}
