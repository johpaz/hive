/**
 * DAGScheduler — Custom errors (HiveLearn local copy)
 */

export class CyclicDependencyError extends Error {
  readonly cycle: string[]
  constructor(cycle: string[]) {
    super(`Cyclic dependency detected: ${cycle.join(" → ")}`)
    this.name = "CyclicDependencyError"
    this.cycle = cycle
  }
}

export class TaskTimeoutError extends Error {
  readonly nodeId: string
  readonly timeoutMs: number
  constructor(nodeId: string, timeoutMs: number) {
    super(`Task "${nodeId}" timed out after ${timeoutMs}ms`)
    this.name = "TaskTimeoutError"
    this.nodeId = nodeId
    this.timeoutMs = timeoutMs
  }
}

export class TaskFailureError extends Error {
  readonly nodeId: string
  readonly cause: Error
  constructor(nodeId: string, cause: Error) {
    super(`Task "${nodeId}" failed: ${cause.message}`)
    this.name = "TaskFailureError"
    this.nodeId = nodeId
    this.cause = cause
  }
}
