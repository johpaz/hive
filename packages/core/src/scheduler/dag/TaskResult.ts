/**
 * DAGScheduler — Result types
 */

export interface NodeSummary {
  id: string
  name: string
  status: "COMPLETED" | "FAILED"
  durationMs: number
  result?: string
  error?: string
  retries: number
}

export interface DAGResult {
  swarmId: string
  totalDurationMs: number
  completed: NodeSummary[]
  failed: NodeSummary[]
  /** true if all nodes completed successfully */
  success: boolean
}
