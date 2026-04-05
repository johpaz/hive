/**
 * DAGScheduler — Main orchestrator
 *
 * Executes a TaskGraph by:
 *   1. Identifying all nodes with no dependencies → mark READY
 *   2. Launching them concurrently via AgentExecutor (respecting maxConcurrentWorkers)
 *   3. When a node completes, finding newly unblocked nodes and launching them
 *   4. Propagating failures to dependent nodes
 *   5. Emitting progress via EventBridge → agentBus + canvas
 *
 * Parallelism model: Promise.race() over a Set of active promises + a FIFO/priority
 * queue of READY nodes waiting for a slot. No Bun Worker threads — workers are async
 * agent calls (runAgentIsolated) running concurrently in the same process.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs"
import * as path from "node:path"
import { logger } from "../../utils/logger"
import { TaskGraph } from "./TaskGraph"
import { TaskNode } from "./TaskNode"
import { AgentExecutor } from "./AgentExecutor"
import { EventBridge } from "./EventBridge"
import { TaskFailureError } from "./errors"
import type { DAGResult, NodeSummary } from "./TaskResult"
import type { ExecutionStrategy } from "./strategies/ParallelStrategy"
import { ParallelStrategy } from "./strategies/ParallelStrategy"

const log = logger.child("dag-scheduler")

export interface IAgentExecutor {
  execute(node: TaskNode, depResults: Record<string, string>, threadId: string): Promise<string>
}

export interface DAGSchedulerOptions {
  strategy?: ExecutionStrategy
  maxConcurrentWorkers?: number
  /** Project ID for agentBus/canvas events */
  projectId?: string
  /** Coordinator agent ID for agentBus events */
  coordinatorId?: string
  /** Disables ASCII log and file logging. Default: false in development */
  silent?: boolean
  /** Custom executor — defaults to AgentExecutor (runAgentIsolated). Override to bypass context-compiler. */
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
    this.executor = options.executor ?? new AgentExecutor()
  }

  abort(): void {
    this.aborted = true
  }

  async execute(graph: TaskGraph, options: DAGSchedulerOptions = {}): Promise<DAGResult> {
    this.aborted = false
    const swarmId = crypto.randomUUID()
    const startedAt = Date.now()

    const projectId = options.projectId ?? `swarm:${swarmId}`
    const coordinatorId = options.coordinatorId ?? "dag-scheduler"
    const silent = options.silent ?? (process.env.NODE_ENV === "production")

    const bridge = new EventBridge(swarmId, projectId, coordinatorId)

    // Allow strategy to precompute (e.g. critical path)
    if (this.strategy.initialize) {
      this.strategy.initialize(graph.nodes)
    }

    bridge.onSwarmStarted(graph.nodes.size)
    this.logState(swarmId, graph, startedAt, silent, swarmId)

    // Seed the READY queue with nodes that have no dependencies
    const readyQueue: TaskNode[] = []
    const completedIds = graph.getCompletedIds()

    for (const node of graph.nodes.values()) {
      if (node.deps.length === 0) {
        node.markReady()
        readyQueue.push(node)
      }
    }

    // Active promise set — we track them with a wrapper so we can drain
    const running = new Set<Promise<void>>()

    const launchNode = (node: TaskNode): void => {
      if (this.aborted) return

      node.markRunning()
      bridge.onTaskStarted(node)
      this.logState(swarmId, graph, startedAt, silent, swarmId)

      const depResults = graph.getDepResults(node.id)
      const threadId = `dag-${swarmId}-${node.id}`

      const p: Promise<void> = this.executor
        .execute(node, depResults, threadId)
        .then(result => {
          node.markCompleted(result)
          log.info(`[DAG] ${node.name} COMPLETED in ${node.elapsedSeconds()}s`)
          bridge.onTaskCompleted(node, graph.getProgress())
          this.logState(swarmId, graph, startedAt, silent, swarmId)

          // Unlock dependent nodes
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
            node.status = "PENDING"
            node.markReady()
            readyQueue.push(node)
          } else {
            node.markFailed(error)
            log.error(`[DAG] ${node.name} FAILED permanently: ${error}`)
            bridge.onTaskFailed(node, graph.getProgress())
            graph.propagateFailure(node.id, error)
            this.logState(swarmId, graph, startedAt, silent, swarmId)
          }
        })
        .finally(() => {
          running.delete(p)
          drain()
        })

      running.add(p)
    }

    // Drain the ready queue into available worker slots
    const drain = (): void => {
      while (readyQueue.length > 0 && running.size < this.maxConcurrentWorkers && !this.aborted) {
        const node = this.strategy.pick(readyQueue)
        if (!node) break
        launchNode(node)
      }
    }

    // Start initial drain
    drain()

    // Wait until the graph is complete
    while (!graph.isComplete() && !this.aborted) {
      if (running.size === 0 && readyQueue.length === 0) {
        // Deadlock guard: no running, nothing ready, but graph not done
        // This can happen if all remaining nodes are FAILED
        break
      }
      // Wait for any active promise to settle
      if (running.size > 0) {
        await Promise.race([...running])
        drain()
      } else {
        // Brief yield to let microtasks settle
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }

    // Collect results
    const completed: NodeSummary[] = []
    const failed: NodeSummary[] = []

    for (const node of graph.nodes.values()) {
      const summary: NodeSummary = {
        id: node.id,
        name: node.name,
        status: node.status === "COMPLETED" ? "COMPLETED" : "FAILED",
        durationMs: node.startedAt ? (node.completedAt ?? Date.now()) - node.startedAt : 0,
        result: node.result,
        error: node.error,
        retries: node.retryCount,
      }
      if (node.status === "COMPLETED") completed.push(summary)
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
    this.logState(swarmId, graph, startedAt, silent, swarmId)

    log.info(`[DAG] swarm ${swarmId} finished. ${completed.length} completed, ${failed.length} failed. Total: ${Math.round(result.totalDurationMs / 1000)}s`)

    return result
  }

  // ─── ASCII log ───────────────────────────────────────────────────────────────

  private logState(
    swarmId: string,
    graph: TaskGraph,
    startedAt: number,
    silent: boolean,
    sessionId: string
  ): void {
    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    const lines: string[] = [`[DAG] swarm:${swarmId.slice(0, 8)} T+${elapsed}s`]

    for (const node of graph.nodes.values()) {
      const icon =
        node.status === "COMPLETED" ? "✓" :
        node.status === "FAILED"    ? "✗" :
        node.status === "RUNNING"   ? "●" : "○"

      const depStr = node.deps.length > 0 ? `  (deps: ${node.deps.join(", ")})` : ""
      const timeStr = node.startedAt ? `  (${node.elapsedSeconds()}s)` : ""
      const statusLabel = node.status.padEnd(10)

      lines.push(`  ${icon} ${node.name.padEnd(24)} ${statusLabel}${timeStr}${depStr}`)
    }

    const output = lines.join("\n")

    if (!silent) {
      // Write to log file (never committed — in .gitignore)
      try {
        const logDir = path.join(process.cwd(), "packages", "core", "logs")
        if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true })
        const logFile = path.join(logDir, `dag-${sessionId.slice(0, 8)}.log`)
        writeFileSync(logFile, output + "\n\n", { flag: "a" })
      } catch {
        // Non-critical — never throw for logging
      }
    }

    log.debug(output)
  }
}
