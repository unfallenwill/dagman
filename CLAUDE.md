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
- `src/models/` — 类型定义和数据模型
- `src/utils/` — 共享工具（文件 I/O、环检测、交互提示）
- `tests/` — vitest 测试，用 tmpdir + chdir 隔离
- `.dagman/nodes/` — 节点定义（YAML 格式）
- `.dagman/runs/` — 运行实例状态和上下文

## 代码规范

- 所有 import 使用 `.js` 扩展名（Node16 模块解析要求）
- 用户可见的错误和提示信息用中文
- 自定义错误类定义在 `src/errors.ts`
- 节点定义存储为 YAML（`kind: Node` 包装），schema 由 `src/utils/json.ts` 的 zod 校验
- 添加节点时自动做环检测（`src/utils/cycle.ts`，DFS 三色标记）

## 提交规范

每次 git commit 时，在 commit message 末尾附加：

```
Co-Authored-By: GLM 5.1 <noreply@z.ai>
```

## 数据存储

```
.dagman/
  .current-run              # 当前活跃运行实例 ID
  nodes/
    <name>.yaml             # 节点定义（kind: Node + Node 字段）
  runs/
    <run-id>/
      run.json              # 运行实例元数据
      state.json            # 节点状态映射
      events.jsonl          # 状态变迁事件日志（追加写入）
      context/
        <node-name>.json    # 每节点上下文数据
```
