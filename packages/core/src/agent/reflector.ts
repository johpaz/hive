/**
 * ACE Reflector — analyzes recent traces and produces insights.
 *
 * Runs in the background (never blocks the main agent loop).
 * Triggered by the tracer after N new traces.
 *
 * Output → `reflections` table → picked up by Curator.
 */

import { logger } from "../utils/logger"

const log = logger.child("reflector")

const MAX_TRACES_TO_ANALYZE = 30
const MIN_TRACES_TO_RUN = 10

/** Main entry point — called from tracer.ts */
export async function runReflector(): Promise<void> {
  try {
    const { getDb } = await import("../storage/sqlite")
    const db = getDb()

    log.info(`[reflector] Starting reflection cycle...`)

    // Fetch traces not yet covered by any reflection
    log.debug(`[reflector] Querying last reflection ID...`)
    const lastReflectionId = (db.query<any, []>(
      "SELECT MAX(id) as mid FROM reflections"
    ).get() as any)?.mid ?? 0
    log.debug(`[reflector] Last reflection ID: ${lastReflectionId}`)

    // Get last processed trace ID from reflections
    log.debug(`[reflector] Querying last processed trace ID with json_each...`)
    let lastProcessedTrace = 0
    try {
      const result = (db.query<any, []>(
        `SELECT MAX(CAST(json_each.value AS INTEGER)) as max_id
         FROM reflections, json_each(reflections.trace_ids)
         WHERE reflections.id = (SELECT MAX(id) FROM reflections)`
      ).get() as any)?.max_id ?? 0
      lastProcessedTrace = result
      log.debug(`[reflector] Last processed trace ID: ${lastProcessedTrace}`)
    } catch (jsonErr) {
      log.error(`[reflector] json_each query failed:`, jsonErr)
      log.error(`[reflector] Full error details:`, {
        message: (jsonErr as Error).message,
        stack: (jsonErr as Error).stack,
        errno: (jsonErr as any).errno,
        byteOffset: (jsonErr as any).byteOffset,
      })
      throw jsonErr // Re-throw to see full stack trace in main catch
    }

    log.debug(`[reflector] Fetching traces from DB, lastProcessedTrace=${lastProcessedTrace}, limit=${MAX_TRACES_TO_ANALYZE}`)
    const traces = db.query<any, [number, number]>(`
      SELECT id, agent_id, agent_name, tool_used, input_summary,
             output_summary, success, error_message, duration_ms, tokens_used, created_at
      FROM traces
      WHERE id > ?
      ORDER BY id ASC
      LIMIT ?
    `).all(lastProcessedTrace, MAX_TRACES_TO_ANALYZE)

    log.debug(`[reflector] Fetched ${traces.length} traces from DB`)

    if (traces.length < MIN_TRACES_TO_RUN) {
      log.debug(`[reflector] Not enough traces (${traces.length}/${MIN_TRACES_TO_RUN}), skipping`)
      return
    }

    log.info(`[reflector] Analyzing ${traces.length} traces...`)

    const insights = analyzeTracesLocally(traces)

    if (insights.length === 0) {
      log.debug("[reflector] No insights generated")
      return
    }

    const traceIds = JSON.stringify(traces.map((t: any) => t.id))

    for (const insight of insights) {
      db.query(`
        INSERT INTO reflections (trace_ids, insight_type, description, affected_tools, affected_agents, confidence)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        traceIds,
        insight.type,
        insight.description,
        insight.affectedTools ? JSON.stringify(insight.affectedTools) : null,
        insight.affectedAgents ? JSON.stringify(insight.affectedAgents) : null,
        insight.confidence,
      )
    }

    log.info(`[reflector] Generated ${insights.length} insights`)

    // Trigger curator
    const { runCurator } = await import("./curator")
    await runCurator()
    
    log.info(`[reflector] Reflection cycle completed successfully`)
  } catch (err) {
    log.error(`[reflector] Error during reflection:`, {
      message: (err as Error).message,
      stack: (err as Error).stack,
      errno: (err as any).errno,
      byteOffset: (err as any).byteOffset,
      code: (err as any).code,
    })
  }
}

// ─── Local analysis (heuristic, no LLM call needed for basic patterns) ────────

interface Insight {
  type: "success_pattern" | "failure_pattern" | "optimization" | "ethics_violation"
  description: string
  affectedTools?: string[]
  affectedAgents?: string[]
  confidence: number
}

function analyzeTracesLocally(traces: any[]): Insight[] {
  const insights: Insight[] = []

  // ── Failure patterns ─────────────────────────────────────────────────────
  const failures = traces.filter((t: any) => !t.success)
  if (failures.length > 3) {
    // Group by tool
    const toolFailures: Record<string, number> = {}
    for (const f of failures) {
      if (f.tool_used) {
        toolFailures[f.tool_used] = (toolFailures[f.tool_used] || 0) + 1
      }
    }
    for (const [tool, count] of Object.entries(toolFailures)) {
      if (count >= 3) {
        insights.push({
          type: "failure_pattern",
          description: `Tool '${tool}' failed ${count} times recently. Consider verifying its configuration or avoiding it for this type of task.`,
          affectedTools: [tool],
          confidence: Math.min(0.9, count / 10),
        })
      }
    }
  }

  // ── Slow tools ───────────────────────────────────────────────────────────
  const slowThresholdMs = 5000
  const slowTools: Record<string, number[]> = {}
  for (const t of traces) {
    if (t.tool_used && t.duration_ms > slowThresholdMs) {
      if (!slowTools[t.tool_used]) slowTools[t.tool_used] = []
      slowTools[t.tool_used].push(t.duration_ms)
    }
  }
  for (const [tool, durations] of Object.entries(slowTools)) {
    if (durations.length >= 3) {
      const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      insights.push({
        type: "optimization",
        description: `Tool '${tool}' is consistently slow (avg ${avg}ms). Cache results when possible or use a faster alternative.`,
        affectedTools: [tool],
        confidence: 0.6,
      })
    }
  }

  // ── High success pattern ─────────────────────────────────────────────────
  const successByTool: Record<string, { ok: number; total: number }> = {}
  for (const t of traces) {
    if (!t.tool_used) continue
    if (!successByTool[t.tool_used]) successByTool[t.tool_used] = { ok: 0, total: 0 }
    successByTool[t.tool_used].total++
    if (t.success) successByTool[t.tool_used].ok++
  }
  for (const [tool, stats] of Object.entries(successByTool)) {
    if (stats.total >= 5 && stats.ok / stats.total >= 0.9) {
      insights.push({
        type: "success_pattern",
        description: `Tool '${tool}' has a high success rate (${stats.ok}/${stats.total}). Prefer it for related tasks.`,
        affectedTools: [tool],
        confidence: stats.ok / stats.total,
      })
    }
  }

  // ── High token usage ─────────────────────────────────────────────────────
  const highTokenTraces = traces.filter((t: any) => t.tokens_used > 4000)
  if (highTokenTraces.length > 3) {
    insights.push({
      type: "optimization",
      description: `${highTokenTraces.length} recent calls used >4000 tokens. Be more concise and use tool results as summaries, not raw dumps.`,
      confidence: 0.7,
    })
  }

  return insights
}
