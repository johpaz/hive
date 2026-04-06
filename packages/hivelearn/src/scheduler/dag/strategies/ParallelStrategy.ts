/**
 * ParallelStrategy — FIFO execution (HiveLearn local copy)
 */

import { TaskNode } from "../TaskNode"

export interface ExecutionStrategy {
  pick(queue: TaskNode[]): TaskNode | undefined
  initialize?(nodes: Map<string, TaskNode>): void
}

export class ParallelStrategy implements ExecutionStrategy {
  pick(queue: TaskNode[]): TaskNode | undefined {
    return queue.shift()
  }
}
