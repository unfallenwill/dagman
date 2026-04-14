# dagman 开发工作流

本项目使用 dagman 管理开发任务。工作流已预定义，你只需按步骤执行。

## 提交规范

每次 git commit 时，在 commit message 末尾附加：

```
Co-Authored-By: GLM 5.1 <noreply@z.ai>
```

## 启动开发

收到用户的开发需求后，创建一个新的运行实例：

```bash
npx dagman run create <需求简述> --switch
```

## 任务循环

重复以下步骤直到没有下一个节点：

### 1. 获取任务

```bash
npx dagman next
```

输出包含节点名称、描述、指令和可用状态。按指令执行任务。

### 2. 读取上游结果

节点的 `depends_on` 指明了上游节点。用 context 命令获取上游保存的数据：

```bash
npx dagman context show <上游节点名>
```

上游节点的上下文包含你需要的设计方案、分析报告等信息。每次开始任务前都应先读取上游数据。

### 3. 保存工作成果

任务过程中产出的中间数据（分析报告、设计方案、测试结果等）保存到当前节点上下文：

```bash
npx dagman context set <当前节点名> <key> <value>
```

上下文是 key-value 结构。值是字符串，如果需要存储结构化数据，使用 JSON 字符串。

### 4. 更新状态

任务完成后，将节点状态更新为 `instructions` 中指示的状态之一：

```bash
npx dagman change <节点名> <状态>
```

- 成功完成 → `success`
- 部分完成 → `partial`
- 失败 → `failed`
- 通过 → `pass`
- 需要修改 → `needs_revision`

状态决定了下游节点是否会被激活。只有当上游依赖的状态匹配 `depends_on` 中声明的期望状态时，下游节点才会出现在 `next` 中。

### 5. 继续

回到步骤 1，获取下一个可执行节点。如果 `next` 返回空，说明所有节点已完成或阻塞。

## 查看全局状态

随时可以查看整个任务图的执行情况：

```bash
npx dagman graph show
```
