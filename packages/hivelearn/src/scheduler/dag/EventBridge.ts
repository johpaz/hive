/**
 * HiveLearn EventBridge — maps DAG lifecycle events to hlSwarmEmitter.
 * Decoupled from core's agentBus and canvas emitter.
 */

import { hlSwarmEmitter } from '../../events/swarm-events'
import { TaskNode } from './TaskNode'
import type { DAGResult } from './TaskResult'

export class EventBridge {
  private swarmId: string
  private coordinatorId: string

  constructor(swarmId: string, _projectId: string, coordinatorId: string) {
    this.swarmId = swarmId
    this.coordinatorId = coordinatorId
  }

  onSwarmStarted(totalTasks: number): void {
    hlSwarmEmitter.emit('swarm:started', {
      swarmId: this.swarmId,
      coordinatorId: this.coordinatorId,
      totalTasks,
      timestamp: Date.now(),
    })
  }

  onTaskStarted(node: TaskNode): void {
    hlSwarmEmitter.emit('worker:task_started', {
      workerId: node.agentId,
      workerName: node.name,
      swarmId: this.swarmId,
      timestamp: Date.now(),
    })
  }

  onTaskCompleted(node: TaskNode, progress: number): void {
    hlSwarmEmitter.emit('worker:task_completed', {
      workerId: node.agentId,
      workerName: node.name,
      result: node.result ?? '',
      progress,
      swarmId: this.swarmId,
      timestamp: Date.now(),
    })
  }

  onTaskFailed(node: TaskNode, progress: number): void {
    hlSwarmEmitter.emit('worker:task_failed', {
      workerId: node.agentId,
      workerName: node.name,
      error: node.error ?? 'unknown error',
      progress,
      swarmId: this.swarmId,
      timestamp: Date.now(),
    })
  }

  onSwarmCompleted(result: DAGResult): void {
    hlSwarmEmitter.emit('swarm:completed', {
      swarmId: this.swarmId,
      coordinatorId: this.coordinatorId,
      success: result.success,
      completedCount: result.completed.length,
      failedCount: result.failed.length,
      totalDurationMs: result.totalDurationMs,
      timestamp: Date.now(),
    })
  }
}
