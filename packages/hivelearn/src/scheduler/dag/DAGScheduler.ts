/**
 * DAGScheduler — HiveLearn local copy
 * Executes a TaskGraph in parallel. No core dependencies except logger.
 */

import { logger } from '../../utils/logger'
import { TaskGraph } from './TaskGraph'
import { TaskNode } from './TaskNode'
import { EventBridge } from './EventBridge'
import type { DAGResult, NodeSummary } from './TaskResult'
import type { ExecutionStrategy } from './strategies/ParallelStrategy'
import { ParallelStrategy } from './strategies/ParallelStrategy'

const log = logger.child('dag-scheduler')

export interface IAgentExecutor {
  execute(node: TaskNode, depResults: Record<string, string>, threadId: string): Promise<string>
}

export interface DAGSchedulerOptions {
  strategy?: ExecutionStrategy
  maxConcurrentWorkers?: number
  projectId?: string
  coordinatorId?: string
  silent?: boolean
  executor?: IAgentExecutor
}

export class DAGScheduler {
  private strategy: ExecutionStrategy
  private maxConcurrentWorkers: number
  private executor: IAgentExecutor
  private aborted = false

  constructor(options: DAGSchedulerOptions = {}) {
    this.strategy = options.strategy ?? new ParallelStrategy()
    this.maxConcurrentWorkers = options.maxConcurrentWorkers ?? 2
    if (!options.executor) throw new Error('DAGScheduler: executor is required in hivelearn')
    this.executor = options.executor
  }

  abort(): void { this.aborted = true }

  async execute(graph: TaskGraph, options: DAGSchedulerOptions = {}): Promise<DAGResult> {
    this.aborted = false
    const swarmId = crypto.randomUUID()
    const startedAt = Date.now()

    const projectId = options.projectId ?? `swarm:${swarmId}`
    const coordinatorId = options.coordinatorId ?? 'hl-coordinator-agent'
    const silent = options.silent ?? (process.env.NODE_ENV === 'production')

    const bridge = new EventBridge(swarmId, projectId, coordinatorId)

    if (this.strategy.initialize) this.strategy.initialize(graph.nodes)

    bridge.onSwarmStarted(graph.nodes.size)
    this.logState(swarmId, graph, startedAt, silent)

    const readyQueue: TaskNode[] = []

    for (const node of graph.nodes.values()) {
      if (node.deps.length === 0) {
        node.markReady()
        readyQueue.push(node)
      }
    }

    const running = new Set<Promise<void>>()

    const launchNode = (node: TaskNode): void => {
      if (this.aborted) return

      node.markRunning()
      bridge.onTaskStarted(node)
      this.logState(swarmId, graph, startedAt, silent)

      const depResults = graph.getDepResults(node.id)
      const threadId = `dag-${swarmId}-${node.id}`

      const p: Promise<void> = this.executor
        .execute(node, depResults, threadId)
        .then(result => {
          node.markCompleted(result)
          log.info(`[DAG] ${node.name} COMPLETED in ${node.elapsedSeconds()}s`)
          bridge.onTaskCompleted(node, graph.getProgress())
          this.logState(swarmId, graph, startedAt, silent)

          const newlyReady = graph.getNewlyReadyNodes(graph.getCompletedIds())
          for (const n of newlyReady) {
            n.markReady()
            readyQueue.push(n)
          }
        })
        .catch(err => {
          const error = err instanceof Error ? err.message : String(err)
          if (node.canRetry()) {
            node.retryCount++
            log.warn(`[DAG] ${node.name} failed (retry ${node.retryCount}/${node.maxRetries}): ${error}`)
            node.status = 'PENDING'
            node.markReady()
            readyQueue.push(node)
          } else {
            node.markFailed(error)
            log.error(`[DAG] ${node.name} FAILED permanently: ${error}`)
            bridge.onTaskFailed(node, graph.getProgress())
            graph.propagateFailure(node.id, error)
            this.logState(swarmId, graph, startedAt, silent)
          }
        })
        .finally(() => {
          running.delete(p)
          drain()
        })

      running.add(p)
    }

    const drain = (): void => {
      while (readyQueue.length > 0 && running.size < this.maxConcurrentWorkers && !this.aborted) {
        const node = this.strategy.pick(readyQueue)
        if (!node) break
        launchNode(node)
      }
    }

    drain()

    while (!graph.isComplete() && !this.aborted) {
      if (running.size === 0 && readyQueue.length === 0) break
      if (running.size > 0) {
        await Promise.race([...running])
        drain()
      } else {
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }

    const completed: NodeSummary[] = []
    const failed: NodeSummary[] = []

    for (const node of graph.nodes.values()) {
      const summary: NodeSummary = {
        id: node.id,
        name: node.name,
        status: node.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
        durationMs: node.startedAt ? (node.completedAt ?? Date.now()) - node.startedAt : 0,
        result: node.result,
        error: node.error,
        retries: node.retryCount,
      }
      if (node.status === 'COMPLETED') completed.push(summary)
      else failed.push(summary)
    }

    const result: DAGResult = {
      swarmId,
      totalDurationMs: Date.now() - startedAt,
      completed,
      failed,
      success: failed.length === 0,
    }

    bridge.onSwarmCompleted(result)
    log.info(`[DAG] swarm ${swarmId} finished. ${completed.length} completed, ${failed.length} failed. Total: ${Math.round(result.totalDurationMs / 1000)}s`)

    return result
  }

  private logState(swarmId: string, graph: TaskGraph, startedAt: number, silent: boolean): void {
    if (silent) return
    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    const lines: string[] = [`[DAG] swarm:${swarmId.slice(0, 8)} T+${elapsed}s`]
    for (const node of graph.nodes.values()) {
      const icon = node.status === 'COMPLETED' ? '✓' : node.status === 'FAILED' ? '✗' : node.status === 'RUNNING' ? '●' : '○'
      lines.push(`  ${icon} ${node.name.padEnd(24)} ${node.status.padEnd(10)}  (${node.elapsedSeconds()}s)`)
    }
    log.debug(lines.join('\n'))
  }
}
