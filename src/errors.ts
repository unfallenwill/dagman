export class NodeNotFoundError extends Error {
  constructor(name: string) {
    super(`节点 '${name}' 不存在`);
    this.name = "NodeNotFoundError";
  }
}

export class ValidationError extends Error {
  errors: string[];

  constructor(message: string, errors: string[] = []) {
    super(message);
    this.name = "ValidationError";
    this.errors = errors;
  }
}

export class FileExistsError extends Error {
  constructor(path: string) {
    super(`文件 '${path}' 已存在`);
    this.name = "FileExistsError";
  }
}

export class CycleError extends Error {
  constructor(nodeName: string) {
    super(`注册节点 '${nodeName}' 会产生循环依赖，已拒绝注册`);
    this.name = "CycleError";
  }
}

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`运行实例 '${runId}' 不存在`);
    this.name = "RunNotFoundError";
  }
}

export class RunExistsError extends Error {
  constructor(runId: string) {
    super(`运行实例 '${runId}' 已存在`);
    this.name = "RunExistsError";
  }
}
