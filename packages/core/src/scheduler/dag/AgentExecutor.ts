/**
 * DAGScheduler — AgentExecutor
 *
 * Bridges the DAGScheduler to the existing runAgentIsolated() call.
 * Adds timeout enforcement via Promise.race().
 *
 * NOTE: There are no Bun Worker threads in Hive OSS. "Workers" are logical
 * agents stored in the DB and executed as async calls in the same process.
 * Parallelism is achieved by launching multiple runAgentIsolated() calls
 * concurrently without awaiting each one serially.
 */

import { runAgentIsolated } from "../../agent/agent-loop"
import { TaskNode } from "./TaskNode"
import { TaskTimeoutError } from "./errors"

export class AgentExecutor {
  /**
   * Execute a TaskNode.
   * Injects dependency results into the task description as context.
   * Returns the final text output from the agent.
   */
  async execute(
    node: TaskNode,
    depResults: Record<string, string>,
    threadId: string
  ): Promise<string> {
    const hasDeps = Object.keys(depResults).length > 0
    const contextBlock = hasDeps
      ? `\n\n---\nContext from completed dependencies:\n${JSON.stringify(depResults, null, 2)}\n---`
      : ""

    const taskDescription = node.taskDescription + contextBlock

    const agentPromise = runAgentIsolated({
      agentId: node.agentId,
      taskDescription,
      threadId,
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      const t = setTimeout(() => {
        reject(new TaskTimeoutError(node.id, node.timeout))
      }, node.timeout)
      // Ensure the timeout timer doesn't prevent process exit
      if (typeof t === "object" && t !== null && "unref" in t) {
        (t as any).unref()
      }
    })

    return Promise.race([agentPromise, timeoutPromise])
  }
}
