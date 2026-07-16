/**
 * ACE Reflector — analyzes recent traces and produces insights.
 *
 * Runs in the background (never blocks the main agent loop).
 * Triggered by the tracer after N new traces.
 *
 * Output → `reflections` collection → picked up by Curator.
 *
 * "Last processed trace" is tracked via a `cursors` collection doc
 * (id="reflector:lastTrace") instead of the SQL json_each/MAX(CAST(...))
 * trick the SQLite version used — HiveDB has no equivalent primitive.
 */

import { logger } from "../utils/logger"
import { col, nextId } from "../storage/hive"
import { getHiveDb } from "../storage/hivedb"
import { loadConfig } from "../config/loader"
import type { HiveDB, ToolStats } from "@johpaz/hive-db"
import type { TraceDoc, ReflectionDoc, CursorDoc } from "../storage/collections"

const log = logger.child("reflector")

const MAX_TRACES_TO_ANALYZE = 30
const MIN_TRACES_TO_RUN = 10
const CURSOR_ID = "reflector:lastTrace"

/** Main entry point — called from tracer.ts */
export async function runReflector(): Promise<void> {
  try {
    log.info(`[reflector] Starting reflection cycle...`)

    const cursorsCol = await col<CursorDoc>("cursors")
    const cursorEntry = await cursorsCol.get(CURSOR_ID)
    const lastProcessedId = cursorEntry?.doc.value ?? null
    log.debug(`[reflector] Last processed trace ID: ${lastProcessedId ?? "(none)"}`)

    const tracesCol = await col<TraceDoc>("traces")
    let candidates = lastProcessedId
      ? await tracesCol.scan({ start: lastProcessedId })
      : await tracesCol.scan({})
    if (lastProcessedId && candidates[0]?.id === lastProcessedId) candidates = candidates.slice(1)

    const traceEntries = candidates.slice(0, MAX_TRACES_TO_ANALYZE)
    const traces = traceEntries.map(e => e.doc)
    log.debug(`[reflector] Fetched ${traces.length} traces from DB`)

    if (traces.length < MIN_TRACES_TO_RUN) {
      log.debug(`[reflector] Not enough traces (${traces.length}/${MIN_TRACES_TO_RUN}), skipping`)
      return
    }

    log.info(`[reflector] Analyzing ${traces.length} traces...`)

    // G9: when enabled, per-tool insights use whole-history stats from HiveDB's
    // event log (toolStats) instead of counters built from just this batch, and
    // causal threads add root-cause/learning-proposal insights on top.
    const causalDb = loadConfig().causalLog?.enabled ? await getHiveDb() : null
    const localInsights = await analyzeTracesLocally(traces, causalDb)
    const causalInsights = await analyzeCausalThreads(traces, causalDb)
    const insights = [...localInsights, ...causalInsights]

    if (insights.length === 0) {
      log.debug("[reflector] No insights generated")
    } else {
      const traceIds = JSON.stringify(traceEntries.map(e => e.id))
      const reflectionsCol = await col<ReflectionDoc>("reflections")

      for (const insight of insights) {
        const id = await nextId("reflections")
        await reflectionsCol.put(id, {
          id,
          trace_ids: traceIds,
          insight_type: insight.type,
          description: insight.description,
          affected_tools: insight.affectedTools ? JSON.stringify(insight.affectedTools) : null,
          affected_agents: insight.affectedAgents ? JSON.stringify(insight.affectedAgents) : null,
          confidence: insight.confidence,
          created_at: Date.now(),
        })
      }

      log.info(`[reflector] Generated ${insights.length} insights`)
    }

    // Advance the cursor regardless of whether insights were generated —
    // these traces have been considered either way.
    const newCursor = traceEntries[traceEntries.length - 1].id
    await cursorsCol.put(CURSOR_ID, { value: newCursor }, cursorEntry ? { expectedVersion: cursorEntry.version } : { expectedVersion: 0 })

    // Trigger curator
    const { runCurator } = await import("./curator")
    await runCurator()

    log.info(`[reflector] Reflection cycle completed successfully`)
  } catch (err) {
    log.error(`[reflector] Error during reflection:`, {
      message: (err as Error).message,
      stack: (err as Error).stack,
    })
  }
}

// ─── Local analysis (heuristic, no LLM call needed for basic patterns) ────────

interface Insight {
  type: "success_pattern" | "failure_pattern" | "optimization" | "ethics_violation" | "root_cause" | "learning_proposal"
  description: string
  affectedTools?: string[]
  affectedAgents?: string[]
  confidence: number
}

// ─── G9 causal-thread analysis (evaluateHarness) ──────────────────────────────

interface DecisionNode {
  seq: number
  agent: string
  description: string
}

interface CausalThreadShape {
  decisions: DecisionNode[]
  toolCalls: Array<{ seq: number; agent: string; tool: string }>
  anomalies: unknown[]
}

interface HarnessFinding {
  kind: "inefficientLoop" | "objectiveDrift" | "rootCause" | "insufficientEvidence"
  seq?: number
  description: string
}

interface HarnessProposal {
  description: string
  confidence: number
}

interface HarnessEvaluationShape {
  processQuality: number
  outputQuality: number
  rootCause?: { seq: number; agent: string }
  findings: HarnessFinding[]
  proposals: HarnessProposal[]
}

/**
 * Evaluate the causal thread of every distinct G9 stream touched by this
 * batch of traces (one thread per agent-loop invocation — see
 * agent-loop.ts's causalStreamId) with HiveDB's harness loop, and turn its
 * root cause / findings / learning proposals into reflector insights.
 *
 * Runs alongside, not instead of, analyzeTracesLocally(): it needs a full
 * causal thread per stream, so it operates per-run rather than per-batch.
 */
async function analyzeCausalThreads(traces: TraceDoc[], causalDb: HiveDB | null): Promise<Insight[]> {
  if (!causalDb) return []

  const insights: Insight[] = []
  const streamIds = new Set(traces.map((t) => t.causal_stream_id).filter((s): s is string => !!s))

  for (const streamId of streamIds) {
    try {
      const thread = (await causalDb.causalThread(streamId)) as CausalThreadShape
      if (!thread.decisions?.length && !thread.toolCalls?.length) continue

      const subset = traces.filter((t) => t.causal_stream_id === streamId)
      const originalIntent = subset[0]?.input_summary ?? ""
      const success = subset.every((t) => t.success)

      const evaluation = (await causalDb.evaluateHarness({
        causalThread: thread,
        similarEpisodes: [],
        originalIntent,
        currentState: { success },
        minConfidence: 0.5,
      })) as HarnessEvaluationShape

      if (evaluation.rootCause) {
        const decision = thread.decisions?.find((d) => d.seq === evaluation.rootCause!.seq)
        insights.push({
          type: "root_cause",
          description: decision
            ? `Root cause in stream ${streamId}: ${decision.description}`
            : `Root cause identified at seq ${evaluation.rootCause.seq} in stream ${streamId} (agent ${evaluation.rootCause.agent}).`,
          affectedAgents: [evaluation.rootCause.agent],
          confidence: 0.6,
        })
      }

      for (const finding of evaluation.findings ?? []) {
        if (finding.kind === "inefficientLoop" || finding.kind === "rootCause") {
          insights.push({
            type: "root_cause",
            description: finding.description,
            confidence: 0.6,
          })
        }
      }

      for (const proposal of evaluation.proposals ?? []) {
        insights.push({
          type: "learning_proposal",
          description: proposal.description,
          confidence: proposal.confidence,
        })
      }
    } catch (err) {
      log.warn(`[reflector] Causal-thread analysis failed for stream ${streamId}: ${(err as Error).message}`)
    }
  }

  return insights
}

async function analyzeTracesLocally(traces: TraceDoc[], causalDb: HiveDB | null): Promise<Insight[]> {
  const insights: Insight[] = []

  // G9: whole-history stats per tool touched by this batch (undefined when
  // disabled, or when the tool has no events in the log yet).
  const statsByTool = new Map<string, ToolStats>()
  if (causalDb) {
    const distinctTools = new Set(traces.map((t) => t.tool_used).filter((t): t is string => !!t))
    for (const tool of distinctTools) {
      try {
        const stats = await causalDb.toolStats(tool)
        if (stats) statsByTool.set(tool, stats)
      } catch (err) {
        log.warn(`[reflector] toolStats(${tool}) failed: ${(err as Error).message}`)
      }
    }
  }

  // ── Failure patterns ─────────────────────────────────────────────────────
  const failures = traces.filter((t) => !t.success)
  if (failures.length > 3) {
    // Group by tool
    const toolFailures: Record<string, number> = {}
    for (const f of failures) {
      if (f.tool_used) {
        toolFailures[f.tool_used] = (toolFailures[f.tool_used] || 0) + 1
      }
    }
    for (const [tool, batchCount] of Object.entries(toolFailures)) {
      const count = statsByTool.get(tool)?.errors ?? batchCount
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
    if (t.tool_used && (t.duration_ms ?? 0) > slowThresholdMs) {
      if (!slowTools[t.tool_used]) slowTools[t.tool_used] = []
      slowTools[t.tool_used].push(t.duration_ms!)
    }
  }
  for (const [tool, durations] of Object.entries(slowTools)) {
    if (durations.length >= 3) {
      const stats = statsByTool.get(tool)
      const avg = stats && stats.invocations > 0
        ? Math.round(stats.totalLatencyMs / stats.invocations)
        : Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
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
  const highTokenTraces = traces.filter((t) => (t.tokens_used ?? 0) > 4000)
  if (highTokenTraces.length > 3) {
    insights.push({
      type: "optimization",
      description: `${highTokenTraces.length} recent calls used >4000 tokens. Be more concise and use tool results as summaries, not raw dumps.`,
      confidence: 0.7,
    })
  }

  return insights
}
