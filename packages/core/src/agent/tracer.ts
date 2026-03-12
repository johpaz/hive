/**
 * Tracer — ACE Generator output.
 *
 * Records every agent execution to the `traces` table.
 * Fire-and-forget (non-blocking). Also updates playbook helpful/harmful counts
 * based on execution outcome.
 */

import { logger } from "../utils/logger"

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
}

/**
 * Save a trace record. Non-blocking — errors are swallowed so they never
 * affect the main agent loop.
 */
export function saveTrace(trace: TraceInput): void {
  // Run asynchronously so it never blocks the caller
  Promise.resolve().then(async () => {
    try {
      const { getDb } = await import("../storage/sqlite")
      const db = getDb()

      db.query(`
        INSERT INTO traces
          (thread_id, agent_id, agent_name, tool_used, input_summary,
           output_summary, success, error_message, duration_ms, tokens_used)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        trace.threadId,
        trace.agentId,
        trace.agentName,
        trace.toolUsed ?? null,
        trace.inputSummary.substring(0, 500),
        trace.outputSummary.substring(0, 500),
        trace.success ? 1 : 0,
        trace.errorMessage ?? null,
        trace.durationMs ?? null,
        trace.tokensUsed ?? null,
      )

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
