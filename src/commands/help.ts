import type { Command } from "commander";
import { readFileSync } from "fs";
import * as path from "path";

function getVersion(): string {
  try {
    // 从脚本所在目录向上查找 package.json（dist/commands/help.js → package.json）
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "0.0.0";
  } catch {
    // 回退到 cwd
    try {
      const pkgPath = path.resolve("package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      return pkg.version ?? "0.0.0";
    } catch {
      return "0.0.0";
    }
  }
}

function buildGuide(version: string): string {
  return `dagman v${version} — 通用 agent 任务编排 CLI 工具

━━━ 概述 ━━━

dagman 是基于有向无环图（DAG）的任务调度器。它本身不执行任务，
而是通过 \`dagman next\` 告诉外部 agent 下一步该做什么。

核心执行循环：
  import → run create → 循环 { next → task start → 执行 → task complete } → 结束

━━━ 核心概念 ━━━

Node      静态任务定义（name, description, instructions），不含运行时状态
Graph     DAG 拓扑结构，通过 edges 列表声明节点间的依赖关系
Run       图的执行实例，\`run create --graph <name>\` 创建时自动计算拓扑层级
Task      运行时实体，由 Node 创建，生命周期：ready → running → success / failed / skipped
Superstep BFS 分层执行，层内所有 ready tasks 可并行，全部到达终态后推进到下一层
Channel   带版本号的 key-value 存储，用于节点间传递数据：
            节点输出 {node}.{key}    边信号 edge:{from}→{to}    全局 _global.{key}

━━━ 标准工作流 ━━━

1. 编写 YAML 定义文件（见下方格式）
2. dagman import plan.yaml                # 导入节点和图定义
3. dagman run create --graph <name> -s    # 创建运行实例并切换
4. dagman next                            # 获取下一个可执行任务
5. dagman task start <node>               # 标记任务运行中
6. （agent 执行实际工作）
7. dagman channel set <node> <key> <val>  # 存储产出（可选）
8. dagman task complete <node>            # 标记任务完成
9. 回到步骤 4，重复直到 "没有可执行的任务"

━━━ YAML 导入格式 ━━━

用 \`---\` 分隔多个文档，可混合 Node 和 Graph：

  kind: Node
  name: setup
  description: 初始化项目环境
  instructions: 安装依赖并创建配置文件
  ---
  kind: Node
  name: build
  description: 构建
  instructions: 运行构建命令
  ---
  kind: Graph
  name: pipeline
  edges:
    - from: build
      to: setup

━━━ 边语义 ━━━

Edge { from, to } 表示 from 依赖于 to（to 先执行）。
expect 默认为 "success"；当 expect 为 "success" 时，to 节点状态为 "skipped" 也视为满足。

━━━ 命令速查 ━━━

定义层：
  node create <name>              创建节点
  node list                       列出节点
  node remove <name>              删除节点
  graph list                      列出图
  graph show [--graph <name>]     展示图结构
  graph validate [--graph <name>] 校验图合法性

执行层：
  import [file]                   导入 YAML（默认从 stdin）
  export [file]                   导出为 YAML（默认到 stdout）
  run create --graph <name> [-s]  创建运行实例（-s 自动切换）
  run list                        列出运行实例
  run switch <run-id>             切换当前运行实例
  run show [run-id]               查看运行详情

调度（核心）：
  next [--all] [--json]           获取下一个/所有可执行任务
  task start <node>               启动任务
  task complete <node>            完成任务
  task fail <node>                标记失败
  task skip <node>                跳过任务
  task retry <node>               重试失败任务

数据层：
  channel set <node> <key> <val>  写入 channel
  channel get <node> <key>        读取 channel
  channel list [node]             列出 channels
  step show                       当前 superstep 状态
  step advance                    手动推进 superstep
  log [node]                      查看执行日志

━━━ 变量引用 ━━━

节点 instructions 支持 Handlebars 模板，引用上游产出：
  {{key}}              当前节点自身 channel
  {{node-name.key}}    上游节点 channel（import 时校验依赖关系）
  {{global.key}}       全局 channel

━━━ 更多帮助 ━━━

  dagman <command> --help    查看子命令详细用法
`;
}

export function registerHelpCommand(program: Command): void {
  program.description("dagman - 通用 agent 任务编排 CLI 工具").version(getVersion());

  program
    .command("help [subcommand]")
    .description("显示使用指南或子命令帮助")
    .action((subcommand?: string) => {
      if (subcommand) {
        const cmd = program.commands.find((c) => c.name() === subcommand);
        if (cmd) {
          cmd.outputHelp();
        } else {
          console.error(`未知命令: ${subcommand}`);
          process.exit(1);
        }
      } else {
        console.log(buildGuide(getVersion()));
      }
    });
}
