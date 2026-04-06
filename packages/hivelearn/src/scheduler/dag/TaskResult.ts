/**
 * DAGScheduler — Result types (HiveLearn local copy)
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
  success: boolean
}
