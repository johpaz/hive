/**
 * DAGScheduler — TaskNode (HiveLearn local copy)
 */

export type NodeStatus = "PENDING" | "READY" | "RUNNING" | "COMPLETED" | "FAILED"

export interface TaskNodeConfig {
  id: string
  agentId: string
  name: string
  taskDescription: string
  deps: string[]
  timeout?: number
  maxRetries?: number
  priority?: number
  metadata?: Record<string, unknown>
}

export class TaskNode {
  readonly id: string
  readonly agentId: string
  readonly name: string
  readonly taskDescription: string
  readonly deps: string[]
  readonly timeout: number
  readonly maxRetries: number
  readonly priority: number
  readonly metadata: Record<string, unknown>

  status: NodeStatus = "PENDING"
  retryCount = 0
  startedAt?: number
  completedAt?: number
  result?: string
  error?: string

  constructor(config: TaskNodeConfig) {
    this.id = config.id
    this.agentId = config.agentId
    this.name = config.name
    this.taskDescription = config.taskDescription
    this.deps = config.deps
    this.timeout = config.timeout ?? 120_000
    this.maxRetries = config.maxRetries ?? 1
    this.priority = config.priority ?? 0
    this.metadata = config.metadata ?? {}
  }

  canStart(completedIds: Set<string>): boolean {
    return this.deps.every(dep => completedIds.has(dep))
  }

  markReady(): void { this.status = "READY" }

  markRunning(): void {
    this.status = "RUNNING"
    this.startedAt = Date.now()
  }

  markCompleted(result: string): void {
    this.status = "COMPLETED"
    this.completedAt = Date.now()
    this.result = result
  }

  markFailed(error: string): void {
    this.status = "FAILED"
    this.completedAt = Date.now()
    this.error = error
  }

  canRetry(): boolean {
    return this.retryCount < this.maxRetries
  }

  elapsedSeconds(): number {
    if (!this.startedAt) return 0
    const end = this.completedAt ?? Date.now()
    return Math.round((end - this.startedAt) / 1000)
  }
}
