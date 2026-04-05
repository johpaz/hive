/**
 * DAGScheduler — EventBridge
 *
 * Maps DAG lifecycle events to the existing agentBus so that the rest of
 * Hive OSS can observe swarm progress without coupling to DAGScheduler directly.
 *
 * Also emits canvas:node_update events so the UI reflects task state in real time.
 */

import { agentBus } from "../../events/agent-bus"
import { emitCanvas } from "../../canvas/emitter"
import { TaskNode } from "./TaskNode"
import { DAGResult } from "./TaskResult"

const STATUS_TO_CANVAS: Record<string, string> = {
  RUNNING: "thinking",
  COMPLETED: "idle",
  FAILED: "error",
}

export class EventBridge {
  private swarmId: string
  private projectId: string
  private coordinatorId: string

  constructor(swarmId: string, projectId: string, coordinatorId: string) {
    this.swarmId = swarmId
    this.projectId = projectId
    this.coordinatorId = coordinatorId
  }

  onSwarmStarted(totalTasks: number): void {
    agentBus.publish("project:started", {
      projectId: this.projectId,
      projectName: `swarm:${this.swarmId}`,
      coordinatorId: this.coordinatorId,
      timestamp: Date.now(),
    })

    emitCanvas("canvas:node_update", {
      nodeId: this.projectId,
      changes: { status: "thinking", label: `Swarm started (${totalTasks} tasks)` },
    })
  }

  onTaskStarted(node: TaskNode): void {
    agentBus.notifyTaskStarted(
      node.agentId,
      node.name,
      0, // task numeric ID not tracked here — DAG uses string IDs
      node.name,
      this.projectId
    )

    emitCanvas("canvas:node_update", {
      nodeId: node.agentId,
      changes: { status: STATUS_TO_CANVAS["RUNNING"], label: node.name },
    })
  }

  onTaskCompleted(node: TaskNode, progress: number): void {
    agentBus.notifyTaskCompleted(
      node.agentId,
      node.name,
      0,
      node.name,
      this.projectId,
      node.result ?? ""
    )

    emitCanvas("canvas:node_update", {
      nodeId: node.agentId,
      changes: { status: STATUS_TO_CANVAS["COMPLETED"], progress },
    })

    // Broadcast overall swarm progress
    agentBus.publish("message:custom", {
      fromWorkerId: this.coordinatorId,
      fromWorkerName: "DAGScheduler",
      topic: "swarm:progress",
      content: String(progress),
      timestamp: Date.now(),
    })
  }

  onTaskFailed(node: TaskNode, progress: number): void {
    agentBus.notifyTaskFailed(
      node.agentId,
      node.name,
      0,
      node.name,
      this.projectId,
      node.error ?? "unknown error"
    )

    emitCanvas("canvas:node_update", {
      nodeId: node.agentId,
      changes: { status: STATUS_TO_CANVAS["FAILED"] },
    })
  }

  onSwarmCompleted(result: DAGResult): void {
    const summary = `Completed ${result.completed.length}/${result.completed.length + result.failed.length} tasks in ${Math.round(result.totalDurationMs / 1000)}s`

    agentBus.publish("project:completed", {
      projectId: this.projectId,
      projectName: `swarm:${this.swarmId}`,
      coordinatorId: this.coordinatorId,
      summary,
      timestamp: Date.now(),
    })

    emitCanvas("canvas:node_update", {
      nodeId: this.projectId,
      changes: {
        status: result.success ? "idle" : "error",
        progress: 100,
        label: summary,
      },
    })
  }
}
