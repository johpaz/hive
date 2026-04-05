/**
 * ParallelStrategy — default for HiveLearn
 *
 * Picks nodes from the READY queue in FIFO order.
 * Nodes are launched immediately when a worker slot is available,
 * otherwise they wait in the queue.
 */

import { TaskNode } from "../TaskNode"

export interface ExecutionStrategy {
  pick(queue: TaskNode[]): TaskNode | undefined
  /** Called once at graph start to allow strategy-level initialization */
  initialize?(nodes: Map<string, TaskNode>): void
}

export class ParallelStrategy implements ExecutionStrategy {
  pick(queue: TaskNode[]): TaskNode | undefined {
    return queue.shift()
  }
}
