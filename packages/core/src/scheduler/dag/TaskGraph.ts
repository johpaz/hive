/**
 * DAGScheduler — TaskGraph
 *
 * Owns the full set of TaskNodes for one swarm execution.
 * Responsibilities:
 *   1. Validate no cyclic dependencies (DFS) at construction time
 *   2. Calculate the critical path (longest weighted path)
 *   3. Provide runtime queries: ready nodes, overall progress
 */

import { TaskNode, type TaskNodeConfig } from "./TaskNode"
import { CyclicDependencyError } from "./errors"

export class TaskGraph {
  readonly nodes: Map<string, TaskNode>
  private criticalPath_: string[] | null = null

  constructor(configs: TaskNodeConfig[]) {
    this.nodes = new Map(configs.map(c => [c.id, new TaskNode(c)]))
    this.validateNoCycles()
  }

  // ─── Validation ─────────────────────────────────────────────────────────────

  private validateNoCycles(): void {
    // Three-color DFS: WHITE=unvisited, GRAY=in-stack, BLACK=done
    const WHITE = 0, GRAY = 1, BLACK = 2
    const color = new Map<string, number>()

    for (const id of this.nodes.keys()) color.set(id, WHITE)

    const path: string[] = []

    const visit = (id: string): void => {
      color.set(id, GRAY)
      path.push(id)

      const node = this.nodes.get(id)!
      for (const dep of node.deps) {
        if (!this.nodes.has(dep)) {
          throw new Error(`TaskGraph: node "${id}" depends on unknown node "${dep}"`)
        }
        const c = color.get(dep)!
        if (c === GRAY) {
          // Found back-edge: reconstruct cycle
          const cycleStart = path.indexOf(dep)
          throw new CyclicDependencyError([...path.slice(cycleStart), dep])
        }
        if (c === WHITE) visit(dep)
      }

      path.pop()
      color.set(id, BLACK)
    }

    for (const id of this.nodes.keys()) {
      if (color.get(id) === WHITE) visit(id)
    }
  }

  // ─── Critical Path ───────────────────────────────────────────────────────────

  /**
   * Returns the IDs of the longest dependency chain (by node count).
   * Nodes on this path get higher priority in PriorityStrategy.
   */
  getCriticalPath(): string[] {
    if (this.criticalPath_) return this.criticalPath_

    // longest[id] = length of longest path ending at id (inclusive)
    const longest = new Map<string, number>()
    const predecessor = new Map<string, string | null>()

    const compute = (id: string): number => {
      if (longest.has(id)) return longest.get(id)!
      const node = this.nodes.get(id)!
      if (node.deps.length === 0) {
        longest.set(id, 1)
        predecessor.set(id, null)
        return 1
      }
      let max = 0
      let maxPred: string | null = null
      for (const dep of node.deps) {
        const l = compute(dep)
        if (l > max) { max = l; maxPred = dep }
      }
      longest.set(id, max + 1)
      predecessor.set(id, maxPred)
      return max + 1
    }

    for (const id of this.nodes.keys()) compute(id)

    // Find sink with max longest
    let sinkId = ""
    let maxLen = 0
    for (const [id, len] of longest) {
      if (len > maxLen) { maxLen = len; sinkId = id }
    }

    // Reconstruct path from sink to source, then reverse
    const path: string[] = []
    let cur: string | null = sinkId
    while (cur !== null) {
      path.push(cur)
      cur = predecessor.get(cur) ?? null
    }
    path.reverse()

    this.criticalPath_ = path
    return path
  }

  // ─── Runtime queries ─────────────────────────────────────────────────────────

  /** Nodes that are still PENDING but now have all deps completed */
  getNewlyReadyNodes(completedIds: Set<string>): TaskNode[] {
    const ready: TaskNode[] = []
    for (const node of this.nodes.values()) {
      if (node.status === "PENDING" && node.canStart(completedIds)) {
        ready.push(node)
      }
    }
    return ready
  }

  /** All nodes currently in READY state */
  getReadyNodes(): TaskNode[] {
    return [...this.nodes.values()].filter(n => n.status === "READY")
  }

  /** IDs of all COMPLETED nodes */
  getCompletedIds(): Set<string> {
    const ids = new Set<string>()
    for (const [id, node] of this.nodes) {
      if (node.status === "COMPLETED") ids.add(id)
    }
    return ids
  }

  /** Collect results of all deps for a given node */
  getDepResults(nodeId: string): Record<string, string> {
    const node = this.nodes.get(nodeId)!
    const results: Record<string, string> = {}
    for (const dep of node.deps) {
      const depNode = this.nodes.get(dep)!
      if (depNode.result !== undefined) results[dep] = depNode.result
    }
    return results
  }

  /** 0–100 progress based on nodes in terminal state */
  getProgress(): number {
    const total = this.nodes.size
    if (total === 0) return 100
    let done = 0
    for (const node of this.nodes.values()) {
      if (node.status === "COMPLETED" || node.status === "FAILED") done++
    }
    return Math.round((done / total) * 100)
  }

  /** True when every node is in a terminal state */
  isComplete(): boolean {
    for (const node of this.nodes.values()) {
      if (node.status === "PENDING" || node.status === "READY" || node.status === "RUNNING") {
        return false
      }
    }
    return true
  }

  /** Propagate FAILED status to all nodes that depend (directly or transitively) on failedId */
  propagateFailure(failedId: string, reason: string): void {
    const failedSet = new Set<string>([failedId])

    let changed = true
    while (changed) {
      changed = false
      for (const node of this.nodes.values()) {
        if (node.status === "PENDING" || node.status === "READY") {
          if (node.deps.some(d => failedSet.has(d))) {
            node.markFailed(`dependency_failed: ${reason}`)
            failedSet.add(node.id)
            changed = true
          }
        }
      }
    }
  }
}
