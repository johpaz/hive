/**
 * DAGScheduler — TaskNode
 *
 * Represents a single node in the task graph. Tracks its own state,
 * retry count, timing, and the results of its dependencies.
 */

export type NodeStatus = "PENDING" | "READY" | "RUNNING" | "COMPLETED" | "FAILED"

export interface TaskNodeConfig {
  /** Unique ID within this graph (can match SQLite task.id) */
  id: string
  /** agents.id of the worker agent to execute */
  agentId: string
  /** Human-readable name for logging */
  name: string
  /** Task description passed to the worker */
  taskDescription: string
  /** IDs of other TaskNodes that must complete first */
  deps: string[]
  /** Timeout in ms before the task is cancelled. Default: 120_000 */
  timeout?: number
  /** How many times to retry on failure. Default: 1 */
  maxRetries?: number
  /** Priority hint for PriorityStrategy. Higher = runs first. Default: 0 */
  priority?: number
  /** Optional arbitrary metadata forwarded to the worker */
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

  /** Returns true if all dependency IDs are in the completed set */
  canStart(completedIds: Set<string>): boolean {
    return this.deps.every(dep => completedIds.has(dep))
  }

  markReady(): void {
    this.status = "READY"
  }

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

  /** Elapsed time in seconds since start, or total duration if done */
  elapsedSeconds(): number {
    if (!this.startedAt) return 0
    const end = this.completedAt ?? Date.now()
    return Math.round((end - this.startedAt) / 1000)
  }
}
