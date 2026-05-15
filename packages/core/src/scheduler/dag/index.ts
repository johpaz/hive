/**
 * DAGScheduler — Public API
 *
 * Usage:
 *   import { DAGScheduler, TaskGraph, ParallelStrategy } from "./dag"
 */

export { DAGScheduler } from "./DAGScheduler"
export type { DAGSchedulerOptions } from "./DAGScheduler"

export { TaskGraph } from "./TaskGraph"
export { TaskNode } from "./TaskNode"
export type { TaskNodeConfig, NodeStatus } from "./TaskNode"
export type { DAGResult, NodeSummary } from "./TaskResult"

export { AgentExecutor } from "./AgentExecutor"
export { EventBridge } from "./EventBridge"

export { CyclicDependencyError, TaskTimeoutError, TaskFailureError } from "./errors"

export { ParallelStrategy } from "./strategies/ParallelStrategy"
export type { ExecutionStrategy } from "./strategies/ParallelStrategy"
export { PriorityStrategy } from "./strategies/PriorityStrategy"

export { createResearchGraph } from "./presets/ResearchPreset"
export type { ResearchAgentIds } from "./presets/ResearchPreset"
