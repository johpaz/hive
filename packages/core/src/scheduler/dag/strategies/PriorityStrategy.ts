/**
 * PriorityStrategy — for research swarms
 *
 * Boosts the priority of nodes on the critical path so they run first
 * when slots are limited. Within same effective priority, FIFO order applies.
 */

import { TaskNode } from "../TaskNode"
import { TaskGraph } from "../TaskGraph"
import type { ExecutionStrategy } from "./ParallelStrategy"

export class PriorityStrategy implements ExecutionStrategy {
  private criticalPathSet = new Set<string>()
  private readonly CRITICAL_BOOST = 1000

  initialize(nodes: Map<string, TaskNode>): void {
    // Build a temporary graph for critical path calculation
    const configs = [...nodes.values()].map(n => ({
      id: n.id,
      agentId: n.agentId,
      name: n.name,
      taskDescription: n.taskDescription,
      deps: n.deps,
      timeout: n.timeout,
      maxRetries: n.maxRetries,
      priority: n.priority,
    }))
    const graph = new TaskGraph(configs)
    for (const id of graph.getCriticalPath()) {
      this.criticalPathSet.add(id)
    }
  }

  pick(queue: TaskNode[]): TaskNode | undefined {
    if (queue.length === 0) return undefined

    // Sort: critical path nodes first, then by node.priority desc, then FIFO (stable)
    queue.sort((a, b) => {
      const aBoost = this.criticalPathSet.has(a.id) ? this.CRITICAL_BOOST : 0
      const bBoost = this.criticalPathSet.has(b.id) ? this.CRITICAL_BOOST : 0
      return (b.priority + bBoost) - (a.priority + aBoost)
    })

    return queue.shift()
  }
}
