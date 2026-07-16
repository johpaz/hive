/**
 * Tracer — ACE Generator output.
 *
 * Records every agent execution to the `traces` collection.
 * Fire-and-forget (non-blocking). Also updates the denormalized
 * `agents.lastTraceAt` field used by the Curator's stale-worker detection.
 */

import { logger } from "../utils/logger"
import { col, nextId, updateDoc } from "../storage/hive"
import type { TraceDoc, AgentDoc } from "../storage/collections"

const log = logger.child("tracer")

export interface TraceInput {
  threadId: string
  agentId: string
  agentName: string
  toolUsed?: string | null
  inputSummary: string
  outputSummary: string
  success: boolean
  errorMessage?: string | null
  durationMs?: number
  tokensUsed?: number
  /** G9 causal stream id for this run, when the causal log is enabled. */
  causalStreamId?: string | null
}

/**
 * Save a trace record. Non-blocking — errors are swallowed so they never
 * affect the main agent loop.
 */
export function saveTrace(trace: TraceInput): void {
  // Run asynchronously so it never blocks the caller
  Promise.resolve().then(async () => {
    try {
      const tracesCol = await col<TraceDoc>("traces")
      const id = await nextId("traces")
      const now = Date.now()
      await tracesCol.put(id, {
        id,
        thread_id: trace.threadId,
        agent_id: trace.agentId,
        agent_name: trace.agentName,
        tool_used: trace.toolUsed ?? null,
        input_summary: trace.inputSummary.substring(0, 500),
        output_summary: trace.outputSummary.substring(0, 500),
        success: trace.success,
        error_message: trace.errorMessage ?? null,
        duration_ms: trace.durationMs ?? null,
        tokens_used: trace.tokensUsed ?? null,
        created_at: now,
        causal_stream_id: trace.causalStreamId ?? null,
      })

      // Denormalized field the Curator scans for stale-worker detection,
      // avoiding a correlated MAX(created_at) query HiveDB has no primitive for.
      await updateDoc<AgentDoc>("agents", trace.agentId, { lastTraceAt: now }).catch(() => { /* agent may not exist */ })

      // Trigger reflector check in background
      checkReflectorTrigger().catch(() => { /* ignore */ })
    } catch (err) {
      log.warn("[tracer] Failed to save trace:", err)
    }
  })
}

// ─── Reflector trigger ────────────────────────────────────────────────────────

const REFLECTOR_TRACE_THRESHOLD = 20  // run reflector after N new traces

let _tracesSinceLastReflection = 0

async function checkReflectorTrigger(): Promise<void> {
  _tracesSinceLastReflection++
  if (_tracesSinceLastReflection < REFLECTOR_TRACE_THRESHOLD) return
  _tracesSinceLastReflection = 0

  // Lazy import to avoid circular deps
  const { runReflector } = await import("./reflector")
  runReflector().catch((err) => {
    log.warn("[tracer] Reflector run failed:", err)
  })
}

// ─── Usage recording ──────────────────────────────────────────────────────────

export function recordLLMUsage(opts: {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
}): void {
  Promise.resolve().then(async () => {
    try {
      const { recordUsage } = await import("../storage/usage")
      recordUsage({
        provider: opts.provider,
        model: opts.model,
        inputTokens: opts.inputTokens,
        outputTokens: opts.outputTokens,
      })
    } catch { /* ignore */ }
  })
}
