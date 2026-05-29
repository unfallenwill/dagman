export class NodeNotFoundError extends Error {
  constructor(name: string) {
    super(`node '${name}' not found`)
    this.name = 'NodeNotFoundError'
  }
}

export class ValidationError extends Error {
  errors: string[]

  constructor(message: string, errors: string[] = []) {
    super(message)
    this.name = 'ValidationError'
    this.errors = errors
  }
}

export class FileExistsError extends Error {
  constructor(path: string) {
    super(`file '${path}' already exists`)
    this.name = 'FileExistsError'
  }
}

export class CycleError extends Error {
  constructor(nodeName: string) {
    super(`registering node '${nodeName}' would create a cycle, registration rejected`)
    this.name = 'CycleError'
  }
}

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`run '${runId}' not found`)
    this.name = 'RunNotFoundError'
  }
}

export class RunExistsError extends Error {
  constructor(runId: string) {
    super(`run '${runId}' already exists`)
    this.name = 'RunExistsError'
  }
}

export class GraphNotFoundError extends Error {
  constructor(name: string) {
    super(`graph '${name}' not found`)
    this.name = 'GraphNotFoundError'
  }
}

/**
 * General CLI error for user-facing validation failures.
 * Used when the error message is already formatted for display.
 */
export class CliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliError'
  }
}
