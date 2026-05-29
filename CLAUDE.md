# dagman 开发工作流

本项目使用 dagman 管理开发任务。工作流已预定义，你只需按步骤执行。

## 开发环境

- `npm run build` / `tsc` — 编译 TypeScript 到 dist/
- `npm run dev` / `tsx src/index.ts` — 开发模式直接运行
- `npm test` / `vitest` — 运行测试

## 项目结构

- `src/commands/` — CLI 命令定义（Commander.js，名词+动词分组风格）
- `src/constants.ts` — 路径常量和 run-aware 路径解析
- `src/services/` — 业务逻辑层
  - `workflow-service.ts` — 核心：统一管理 Channel、Task、Superstep（workflow.jsonl）
  - `next-service.ts` — Superstep 感知的调度（从 workflow 读取 ready tasks）
  - `run-service.ts` — 运行实例管理（创建时计算拓扑层级）
  - `node-service.ts` — 节点定义 CRUD
  - `graph-service.ts` — 图定义 CRUD + 展示
  - `event-service.ts` — 细粒度 task 事件日志
  - `import-service.ts` / `export-service.ts` — YAML 导入导出
  - `validator.ts` — 图校验
- `src/models/` — 类型定义和数据模型
  - `node.ts` — Node（纯静态定义，无运行时状态）
  - `graph.ts` — Graph、Edge
  - `channel.ts` — Channel（带版本号的状态单元）+ 命名工具函数
  - `task.ts` — Task（运行时实体，ready/running/success/failed/skipped）
  - `superstep.ts` — WorkflowRecord、RunInfo、WorkflowState
  - `event.ts` — Event（审计日志条目）
- `src/utils/` — 共享工具（文件 I/O、拓扑计算、模板渲染、交互提示）
- `tests/` — vitest 测试，用 tmpdir + chdir 隔离
- `.dagman/nodes/` — 节点定义（YAML 格式，`kind: Node`）
- `.dagman/graphs/` — 图定义（YAML 格式，`kind: Graph`）
- `.dagman/runs/` — 运行实例（workflow.jsonl 状态 + events.jsonl 审计）

## 核心概念

### Channel + Version

所有运行时数据统一为 Channel，每个 channel 有 `value` + `version`：
- 节点上下文 channel：`{node}.{key}`（节点执行产出）
- Edge channel：`edge:{from}→{to}`（依赖满足信号）
- 全局 channel：`_global.{key}`（跨节点共享）

### Node → Task 分离

- **Node**：纯静态定义（name, description, instructions），不承载状态
- **Task**：运行时实体，由 Superstep 从 Node 创建，有生命周期：ready → running → success/failed/skipped
- 失败的 task 可通过 `task retry` 重置为 ready

### Superstep（Pregel-like）

- DAG 按拓扑结构 BFS 分层，每层是一个 Superstep
- 层内所有 ready tasks 可并行执行
- 当前 step 所有 task 到达终态后，自动推进到下一层
- superstep 内有 task 失败则暂停，等待人工处理

### workflow.jsonl

追加写入的 JSONL 文件，每行记录一个 superstep 的状态快照：
```jsonl
{"step":0,"status":"completed","tasks":[...],"channelChanges":{"edge:A→B":{"value":"success","version":1,...}},...}
{"step":1,"status":"running","tasks":[...],"channelChanges":{},...}
```
- `channelChanges` 只记录本 step 有变化的 channel 及其最新值
- 读取完整状态：累积所有行的 `channelChanges`

## 代码规范

- 所有 import 使用 `.js` 扩展名（Node16 模块解析要求）
- 用户可见的错误和提示信息用中文
- 自定义错误类定义在 `src/errors.ts`
- 节点定义存储为 YAML（`kind: Node`），不含依赖关系
- 图定义存储为 YAML（`kind: Graph`），边列表声明依赖关系
- schema 由 `src/utils/json.ts` 的 zod 校验
- 拓扑计算（环检测、层级计算、邻接表）集中在 `src/utils/topology.ts`
- import/export 默认使用 stdin/stdout，参数指定文件

## 提交规范

每次 git commit 时，在 commit message 末尾附加：

```
Co-Authored-By: GLM 5.1 <noreply@z.ai>
```

## CLI 命令

### 节点和图（定义层）
- `node create/list/remove` — 节点定义管理
- `graph list/show/validate` — 图定义管理

### 运行和工作流（执行层）
- `run create [label] --graph <name> -s` — 创建运行实例（自动计算拓扑层级）
- `run list/switch/show` — 运行实例管理

### 任务生命周期
- `task list/show/start/complete/fail/skip/retry` — Task 生命周期管理

### Channel 管理
- `channel list/get/set/clear` — Channel 读写（version 自动递增）

### Superstep
- `step show/advance/history` — Superstep 查看和手动推进

### 调度
- `next [--all] [--step] [--json]` — 返回当前 superstep 的 ready task(s)

### 其他
- `log [node]` — 审计日志
- `import/export` — YAML 导入导出

## 数据存储

```
.dagman/
  .current-run              # 当前活跃运行实例 ID
  nodes/
    <name>.yaml             # 节点定义（kind: Node，无 depends_on）
  graphs/
    <name>.yaml             # 图定义（kind: Graph，edges 列表）
  runs/
    <run-id>/
      run.json              # 运行元数据（含 graphName、currentStep、status、layerAssignment）
      workflow.jsonl         # 工作流状态（channels + tasks + 快照，追加写入）
      events.jsonl          # 细粒度 task 事件日志（追加写入）
```

## 边语义

- `Edge { from, to, expect? }` — `from` 依赖于 `to`，`expect` 默认 `"success"`
- `skipped` 等价于 `success`：当 `expect` 为 `"success"` 时，`to` 节点状态为 `"skipped"` 也视为满足
- 运行实例通过 `run create --graph <name>` 绑定图，创建时自动计算拓扑层级
