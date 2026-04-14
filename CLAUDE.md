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

重复以下步骤直到 `next` 返回空：

### 1. 获取任务

```bash
npx dagman next
```

输出包含节点名称、描述、指令和可用状态。按指令执行任务。

### 2. 读取上游数据

仅当节点的 `depends_on` 非空时执行。获取上游节点的上下文：

```bash
npx dagman context show <上游节点名>
```

如只需特定字段，用 `context get <节点名> <key>` 精确获取。

### 3. 执行任务并保存成果

按 `instructions` 指令执行任务。过程中产出的中间数据保存到当前节点上下文：

```bash
npx dagman context set <当前节点名> <key> <value>
```

上下文是 key-value 结构。值是字符串，如需存储结构化数据，使用 JSON 字符串。

### 4. 更新状态

```bash
npx dagman status set <节点名> <状态>
```

可选状态为全局固定值：
- `success` — 成功完成，激活下游
- `failed` — 失败，阻塞下游
- `skipped` — 主动跳过，等同于 success 激活下游

（`pending` 为初始状态，不可手动设置。）

只有当上游依赖的状态匹配 `depends_on` 中声明的期望状态时，下游节点才会出现在 `next` 中。`skipped` 状态也会满足期望 `success` 的依赖。

## 失败处理

当节点失败时：
1. 将失败原因记录到当前节点 context（`context set <节点名> error <原因>`）
2. 状态设为 `failed`
3. 向用户报告失败原因和节点名称，等待指示。不要自行重试或跳过。

## 查看全局状态

随时可查看整个任务图的执行情况：

```bash
npx dagman graph show
```

## 任务完成

当 `next` 返回空时，用 `graph show` 确认所有节点状态，向用户报告完成情况。
