# dagman

基于有向无环图（DAG）的通用 Agent 任务编排 CLI 工具。

dagman 将复杂的多步骤任务拆分为节点，通过边（Edge）构成 DAG，由外部 Agent 循环调用 `dagman next` 驱动执行。它本身不执行任务，而是作为调度器告诉 Agent 下一步该做什么、有哪些上下文可用。

## 安装

```bash
npm install -g @unfallenwill/dagman
```

或从源码构建：

```bash
git clone <repo-url> dagman
cd dagman
npm install
npm run build
npm link
```

## 快速开始

### 1. 编写计划文件

创建一个 YAML 文件，用 `---` 分隔多个文档。节点（`kind: Node`）定义"做什么"，图（`kind: Graph`）定义"怎么连"：

```yaml
kind: Node
name: setup
description: 初始化项目环境
instructions: 安装依赖并创建配置文件
---
kind: Node
name: lint
description: 代码检查
instructions: 运行 ESLint 检查所有源文件
---
kind: Node
name: test
description: 运行测试
instructions: 执行完整测试套件
---
kind: Node
name: deploy
description: 部署到生产环境
instructions: 构建并部署到生产服务器
---
kind: Graph
name: ci
edges:
  - from: lint
    to: setup
  - from: test
    to: setup
  - from: deploy
    to: lint
  - from: deploy
    to: test
```

### 2. 导入节点和图

```bash
dagman import plan.yaml

# 或从标准输入
cat plan.yaml | dagman import
```

### 3. 创建运行实例

```bash
dagman run create my-deploy --graph ci --switch
```

### 4. 驱动执行

```bash
# 查看下一个可执行节点
dagman next

# 执行任务后记录结果
dagman status set setup success

# 存储上下文供下游节点使用
dagman context set setup output-path /tmp/build

# 继续下一个节点
dagman next

# ... 重复直到没有可执行节点
```

### 5. 导出

```bash
# 导出到标准输出
dagman export

# 导出指定图及其引用的节点
dagman export --graph ci > plan.yaml

# 导出到文件
dagman export plan.yaml
```

## 命令参考

### `dagman import [file]`

从 YAML 文件或标准输入导入节点和图。支持 `kind: Node` 和 `kind: Graph` 混合的 multi-document YAML。跳过已存在的同名节点和图。

```bash
dagman import plan.yaml   # 从文件导入
dagman import < plan.yaml # 从标准输入导入
```

### `dagman export [file]`

导出节点和图为 YAML。默认输出到标准输出。

```bash
dagman export                    # 导出所有节点和图
dagman export --graph ci         # 导出指定图及其引用的节点
dagman export > plan.yaml        # 导出到标准输出
dagman export plan.yaml          # 导出到文件
```

### `dagman node`

节点生命周期管理。

```bash
dagman node create <name>          # 创建节点（交互式输入描述和指令）
dagman node list                   # 列出所有节点
dagman node remove <name> [--force] # 删除节点
```

### `dagman status`

节点状态管理。可选状态：`success`、`failed`、`skipped`。

```bash
dagman status set <name> <state>   # 设置节点状态
dagman status show <name>          # 查看节点状态
```

### `dagman context`

节点上下文管理。每个节点可存储 key-value 数据，供下游节点读取。

```bash
dagman context show <name>              # 查看节点全部上下文
dagman context set <name> <key> <value> # 设置上下文
dagman context get <name> <key>         # 获取单个值
dagman context clear <name>             # 清除全部上下文
```

### `dagman graph`

DAG 可视化和验证。

```bash
dagman graph list                # 列出所有图
dagman graph show --graph <name> # 显示节点图及当前状态
dagman graph validate --graph <name> # 检查缺失依赖、无效状态、环、孤立节点
```

`graph show` 输出示例：

```
deploy [pending] -> lint:success, test:success
lint [pending] -> setup:success
setup [success 14:30]
test [pending] -> setup:success
```

### `dagman run`

运行实例管理。每个运行实例拥有独立的状态、事件日志和上下文，并绑定到一个图。

```bash
dagman run create [label] --graph <name> [--switch]  # 创建运行实例并绑定图
dagman run list                                      # 列出所有运行实例
dagman run switch <run-id>                           # 切换当前运行实例
dagman run show [run-id]                             # 查看运行实例详情
```

### `dagman next`

调度核心。查找下一个（或所有）依赖已满足、尚未执行的节点。

```bash
dagman next              # 返回下一个可执行节点
dagman next --all        # 返回所有可执行节点
dagman next --json       # JSON 格式输出
dagman next --run <id>   # 指定运行实例
```

输出包含节点信息、可用状态、当前上下文和上游上下文。

### `dagman log`

查看节点状态变迁事件日志。

```bash
dagman log              # 查看所有状态变迁
dagman log <node>       # 查看指定节点的状态变迁
dagman log --run <id>   # 指定运行实例
```

## 边与依赖关系

节点不包含依赖信息。依赖关系通过图中的边（Edge）声明：

```yaml
kind: Graph
name: ci
edges:
  # 简写：lint 依赖于 setup，期望 setup 状态为 success
  - from: lint
    to: setup

  # 完整：指定期望的上游状态
  - from: optional-check
    to: setup
    expect: skipped
```

`expect` 默认为 `"success"`。当期望 `success` 时，上游节点状态为 `skipped` 也视为满足（跳过等价于成功）。

## 数据存储

所有数据存储在项目目录下的 `.dagman/` 中：

```
.dagman/
  .current-run              # 当前活跃的运行实例 ID
  nodes/
    <name>.yaml             # 节点定义（kind: Node）
  graphs/
    <name>.yaml             # 图定义（kind: Graph）
  runs/
    <run-id>/
      run.json              # 运行实例元数据（含 graphName 绑定）
      state.json            # 节点状态映射
      events.jsonl          # 状态变迁事件日志（追加写入）
      context/
        <node-name>.json    # 每个节点的上下文数据
```

节点定义全局共享，图定义拓扑关系，状态和上下文按运行实例隔离。

## 开发

```bash
npm install          # 安装依赖
npm run build        # 编译 TypeScript
npm run dev          # 开发模式运行
npm test             # 运行测试
```

## License

MIT
