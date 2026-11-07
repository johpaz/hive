/**
 * Compaction — Fase 6.
 *
 * Compresses conversation history when token count exceeds threshold.
 * Uses the active LLM to summarize old messages, preserving:
 *   - User data and preferences
 *   - Decisions made
 *   - Tool results
 *   - Context needed to continue
 *
 * Saves summary to `summaries` table. Original messages are kept (audit trail)
 * but the Context Compiler uses the summary instead of old messages.
 *
 * Also implements "tool result clearing": replaces old tool results with
 * short summaries in the in-memory message array before model calls.
 */

import { logger } from "../utils/logger"
import {
  getTotalTokens,
  getMessagesAfter,
  getSummary,
  saveSummary,
  getMessageCount,
  isInternalSource,
  type StoredMessage,
} from "./conversation-store"
import { estimateTokens } from "../utils/toon"
import { callLLM, resolveProviderConfig, getDefaultLLM, type ContentPart } from "./llm-client"
import { col, fromIndexable } from "../storage/hive"
import type { AgentDoc, ModelDoc } from "../storage/collections"
import { loadConfig } from "../config/loader"
import { indexThreadSummary } from "./summary-memory"
import { indexThreadMessages } from "./message-memory"
import { HANDOFF_SYSTEM_PROMPT, buildHandoffPrompt, parseHandoff, renderHandoff } from "./handoff"

const log = logger.child("compaction")

// Token budget: compress when stored tokens exceed this threshold
// Will be overridden by model's context_window at runtime if available
const COMPACT_TOKEN_THRESHOLD = 32000  // ~25% of 128K default context window
const KEEP_LAST_N_MESSAGES = 5         // always keep most recent N messages
const TOOL_RESULT_MAX_CHARS = 200      // max chars for old tool results after clearing
const MAX_TRANSCRIPT_MSGS = 40         // cap messages sent to summarizer (avoids OOM on small models)
const MAX_MSG_CHARS = 800              // chars per message in transcript
const MAX_TRANSCRIPT_CHARS = 24_000    // ~6K tokens: tope de la transcripción entera (modelos locales pequeños)

/** Los límites de la compactación, expuestos para que el benchmark (bench/compaction) mida con los mismos valores. */
export const COMPACTION_LIMITS = {
  keepLastMessages: KEEP_LAST_N_MESSAGES,
  maxTranscriptMsgs: MAX_TRANSCRIPT_MSGS,
  maxMsgChars: MAX_MSG_CHARS,
  maxTranscriptChars: MAX_TRANSCRIPT_CHARS,
} as const
// Compaction runs before the turn and blocks it. A local model on CPU took
// minutes here; past this bound the turn goes on uncompacted — the context
// compiler already trims history to the window, so nothing overflows.
const COMPACTION_TIMEOUT_MS = 60_000

/** Ventana asumida cuando no se conoce la del modelo: `COMPACT_TOKEN_THRESHOLD` es su 25 %. */
const ASSUMED_CONTEXT_WINDOW = 128_000

/**
 * A partir de cuántos tokens de historial se compacta.
 *
 * `agent.context.compactionThreshold` es una PROPORCIÓN de la ventana del
 * modelo (≤1, por defecto 0.25); un valor mayor que 1 se lee como tokens
 * absolutos. La ventana es la que el modelo tiene configurada. Sin
 * configuración, el 25 % de la ventana conocida. Portado de hive-sdk.
 */
export function resolveCompactionThreshold(configured: number | undefined, contextWindow?: number): number {
  const known = contextWindow && contextWindow > 0 ? contextWindow : undefined
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return configured <= 1
      ? Math.floor((known ?? ASSUMED_CONTEXT_WINDOW) * configured)
      : Math.floor(configured)
  }
  return known ? Math.floor(known * 0.25) : COMPACT_TOKEN_THRESHOLD
}

/**
 * La compactación con modelo es el ÚLTIMO recurso: antes de ella, lo que sale de la ventana ya se recupera sin
 * modelo (los mensajes se indexan al guardarse y cada turno trae los relevantes; `conversation_read`). Por eso
 * el umbral es alto: cada compactación pierde detalle.
 */
export const DEFAULT_COMPACTION_RATIO = 0.65
/** Parte del contexto que no se puede compactar (sistema, herramientas, skills) si aún no se ha medido. */
const DEFAULT_FIXED_TOKENS = 10_000
/** Por debajo de esto no merece una llamada al modelo. */
const MIN_COMPACT_HISTORY_TOKENS = 2_000
/** Reserva para la respuesta y el error de estimación: la misma que usa el compilador (`COMPACT_RATIO`). */
const USABLE_RATIO = 0.8
/** Margen sobre el presupuesto de historial del compilador: compactar antes de que empiece a descartar turnos. */
const BUDGET_SAFETY = 0.9

/**
 * A partir de cuántos tokens de HISTORIAL se compacta.
 *
 * `agent.context.compactionThreshold` ≤ 1 es la parte del espacio útil de entrada que puede ocupar el contexto
 * TOTAL del turno (sistema + herramientas + historial); por defecto 0,65. El espacio útil es la ventana por 0,8:
 * el resto es la respuesta y el error de estimación. Como la parte fija no se puede compactar, al historial le
 * toca lo que queda: `ratio × útil − fijo`. Un valor > 1 son tokens de historial, sin más cálculo. Para volver
 * al comportamiento anterior (25 % de la ventana) usa `resolveCompactionThreshold` o fija tokens.
 *
 * Tres protecciones: nunca por encima del 90 % del presupuesto de historial del compilador; nunca por debajo de
 * 2000 tokens; y sin ventana conocida se asume una de 128K.
 */
export function resolveCompactionTrigger(o: { configured?: number; window?: number; fixedTokens?: number }): number {
  const { configured } = o
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 1) return Math.floor(configured)
  const window = o.window && o.window > 0 ? o.window : ASSUMED_CONTEXT_WINDOW
  const ratio = typeof configured === "number" && Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_COMPACTION_RATIO
  const fixed = Math.min(Math.max(0, o.fixedTokens ?? DEFAULT_FIXED_TOKENS), Math.floor(window * 0.5))
  const budget = Math.max(Math.floor(window * 0.25), Math.floor(window * USABLE_RATIO) - fixed)
  const ceiling = Math.floor(budget * BUDGET_SAFETY)
  const raw = Math.floor(ratio * window * USABLE_RATIO) - fixed
  return Math.min(ceiling, Math.max(MIN_COMPACT_HISTORY_TOKENS, raw))
}

/**
 * Cuánto de lo acumulado ve el resumen en UNA llamada, según la ventana. Con umbrales altos se acumulan decenas
 * de miles de tokens; un tope fijo de 40 mensajes dejaba al resumen ver una fracción. Crece con la ventana (un
 * modelo local pequeño sigue con los topes de siempre) y sigue siendo una sola llamada.
 */
export function transcriptLimits(window?: number): { maxMsgs: number; maxChars: number } {
  const w = window && window > 0 ? window : ASSUMED_CONTEXT_WINDOW
  const maxChars = Math.min(100_000, Math.max(MAX_TRANSCRIPT_CHARS, Math.floor(w * 0.1 * 3.5)))
  const maxMsgs = Math.min(160, Math.max(MAX_TRANSCRIPT_MSGS, Math.floor(maxChars / 600)))
  return { maxMsgs, maxChars }
}

/**
 * Tokens de la parte fija del último prompt compilado de cada hilo (sistema + herramientas). La compactación se
 * decide ANTES de compilar el turno, así que usa la medida del turno anterior.
 */
const fixedTokensByThread = new Map<string, number>()
export function noteFixedTokens(threadId: string, tokens: number): void {
  if (fixedTokensByThread.size > 500) fixedTokensByThread.clear()
  fixedTokensByThread.set(threadId, tokens)
}

/**
 * Tokens del historial VIVO: el resumen más lo posterior a él. Los mensajes ya
 * resumidos siguen guardados (auditoría) pero el modelo no los lee; contarlos
 * haría que, pasado el umbral una vez, se recompactara en cada turno.
 */
async function liveTokens(threadId: string): Promise<number> {
  const summary = await getSummary(threadId)
  if (!summary) return getTotalTokens(threadId)
  const after = await getMessagesAfter(threadId, summary.last_message_id)
  return estimateTokens(summary.summary) + after.reduce((sum, m) => sum + m.token_count, 0)
}

/**
 * Check if compaction is needed and run it if so.
 * Called at the start of each agent loop iteration.
 */
export async function maybeCompact(
  threadId: string,
  notify?: { channel: string; userId: string },
  /** The window the provider really reads (resolveProviderConfig); overrides the model row. */
  contextWindow?: number,
  /** The turn's abort signal: cancelling the turn also stops its compaction. */
  signal?: AbortSignal,
): Promise<void> {
  try {
    const totalTokens = await liveTokens(threadId)

    // La ventana la da el modelo (la que el usuario configuró en su fila);
    // el umbral es la proporción `agent.context.compactionThreshold` de ella.
    let windowSize = contextWindow
    if (!windowSize) try {
      const agentsCol = await col<AgentDoc>("agents")
      const coordinators = await agentsCol.findBy("role", "coordinator", { limit: 1 })
      const modelId = fromIndexable(coordinators[0]?.doc.model_id ?? null)
      if (modelId) {
        const modelsCol = await col<ModelDoc>("models")
        // El id se busca completo: recortar el primer segmento rompía cualquier
        // modelo cuyo nombre lleve barra (meta/llama-3.3-70b-instruct buscaba
        // "llama-3.3-70b-instruct", no encontraba nada y caía al default).
        const modelEntry = await modelsCol.get(modelId)
        if (modelEntry?.doc.context_window) windowSize = modelEntry.doc.context_window
      }
    } catch { /* use default threshold */ }

    const effectiveThreshold = resolveCompactionTrigger({
      configured: loadConfig().agent?.context?.compactionThreshold,
      window: windowSize,
      fixedTokens: fixedTokensByThread.get(threadId),
    })

    if (totalTokens < effectiveThreshold) return

    const summary = await getSummary(threadId)
    const totalMessages = await getMessageCount(threadId)

    // Already summarized up to near the current state
    if (summary && summary.last_message_id > totalMessages - KEEP_LAST_N_MESSAGES) return

    log.info(`[compaction] Compacting thread=${threadId} tokens=${totalTokens} threshold=${effectiveThreshold}`)
    const timeout = AbortSignal.timeout(COMPACTION_TIMEOUT_MS)
    await compactThread(threadId, notify, signal ? AbortSignal.any([signal, timeout]) : timeout)
  } catch (err) {
    log.warn("[compaction] Error during compaction check:", err)
  }
}

/**
 * Find a clean cut point: the "keep" side must begin with a user turn so we
 * never leave orphaned tool messages at the start of the visible window.
 * Internal events (delegation fan-in) are persisted as role:"user", so they
 * are valid boundaries here same as human turns.
 * Returns 0 when no clean boundary exists (caller should skip compaction).
 */
export function findCompactionCutIndex(rows: StoredMessage[], keepLastN = KEEP_LAST_N_MESSAGES): number {
  let cutIndex = rows.length - keepLastN
  while (cutIndex > 0 && rows[cutIndex]?.role !== "user") {
    cutIndex--
  }
  return cutIndex
}

/**
 * Render a transcript for the summarizer LLM. Internal events (delegation
 * fan-in notices) are labeled distinctly — they are persisted as
 * role:"user" so the LLM treats them as input, but labeling them [USER] here
 * would make the summarizer attribute system-generated task outcomes to the
 * human, baking that misattribution into the durable summary.
 */
export function renderTranscript(rows: StoredMessage[], maxMsgChars = MAX_MSG_CHARS): string {
  return rows
    .map((r) => {
      const label = isInternalSource(r.source) ? "EVENTO INTERNO" : r.role.toUpperCase()
      return `[${label}]: ${r.content.substring(0, maxMsgChars)}`
    })
    .join("\n\n")
}

/**
 * Compress a thread's history into a summary.
 */
export async function compactThread(
  threadId: string,
  notify?: { channel: string; userId: string },
  signal?: AbortSignal,
): Promise<void> {
  // Solo lo posterior al resumen anterior: ese ya está en su traspaso. Se lee
  // sin tope de longitud; `getHistory()` devolvía los 200 mensajes MÁS ANTIGUOS,
  // así que en un hilo largo cada compactación veía el mismo corte que la
  // primera y la compactación dejaba de avanzar pasado el mensaje ~200.
  const existingSummary = await getSummary(threadId)
  const allMessages = await getMessagesAfter(threadId, existingSummary?.last_message_id ?? -1)
  if (allMessages.length <= KEEP_LAST_N_MESSAGES) return

  const cutIndex = findCompactionCutIndex(allMessages)
  if (cutIndex <= 0) {
    log.info(`[compaction] No clean user-turn boundary found — skipping`)
    return
  }

  const toSummarize = allMessages.slice(0, cutIndex)
  if (toSummarize.length === 0) return

  const lastSummarizedId = toSummarize[toSummarize.length - 1].id

  // Todo lo que se resume es posterior al resumen anterior, que entra por su traspaso.
  const fresh = toSummarize

  const defaultLLM = await getDefaultLLM()
  if (!defaultLLM) throw new Error("No active LLM providers/models configured in the database")

  const providerCfg = await resolveProviderConfig(defaultLLM.provider, defaultLLM.model)

  // Cap transcript to avoid overflowing small model contexts (se conserva la cola, lo más reciente). El tope
  // crece con la ventana del modelo que resume.
  const limits = transcriptLimits(providerCfg.contextWindow)
  const capped = fresh.slice(-limits.maxMsgs)
  const rendered = renderTranscript(capped)
  const transcript = rendered.length > limits.maxChars ? rendered.slice(-limits.maxChars) : rendered
  const previous = existingSummary
    ? (existingSummary.structured ? renderHandoff(existingSummary.structured) : existingSummary.summary)
    : null

  const summaryResponse = await callLLM({
    ...providerCfg,
    signal,
    messages: [
      {
        role: "system",
        content: HANDOFF_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: buildHandoffPrompt({ transcript, messageCount: capped.length, previous }),
      },
    ],
  })

  // A failed provider call still returns a populated `content` (the error text),
  // so this has to gate on stop_reason — otherwise the summary that permanently
  // replaces N messages of history becomes "[LLM Error] ...". Skipping leaves the
  // thread uncompacted, which is recoverable; saving is not.
  if (summaryResponse.stop_reason === "error") {
    log.warn(
      `[compaction] Summarizer call failed (${summaryResponse.error?.message ?? "unknown error"}) — `
      + `keeping thread ${threadId} uncompacted rather than saving the error as its summary`
    )
    return
  }

  const raw = summaryResponse.content.trim()
  if (!raw) return

  // Traspaso estructurado; si el modelo no devolvió JSON válido y lo que dio es
  // prosa, se guarda como resumen libre (el formato anterior). Si parece un JSON
  // roto, no se guarda: el hilo queda sin compactar, que es recuperable.
  const structured = parseHandoff(raw)
  if (!structured && /^[`{\[]/.test(raw)) {
    log.warn(`[compaction] Handoff JSON inválido para thread=${threadId} — se deja sin compactar`)
    return
  }
  const summary = structured ? renderHandoff(structured) : raw

  await saveSummary(
    threadId, summary, (existingSummary?.messages_covered ?? 0) + toSummarize.length, lastSummarizedId, structured,
  )
  // Memoria entre hilos: segundo plano, fuera del camino de la respuesta.
  void indexThreadSummary(threadId, summary)
  // Lo compactado sigue siendo recuperable: conversation_read lo busca en este índice.
  void indexThreadMessages(threadId, fresh)
  log.info(
    `[compaction] Thread ${threadId} compacted: ${toSummarize.length} msgs → ${estimateTokens(summary)} tokens`
  )

  // Notify user in their active channel (non-critical)
  if (notify?.channel && notify?.userId) {
    try {
      const { sendToUserChannel } = await import("../gateway/channel-notify")
      await sendToUserChannel(
        notify.channel,
        notify.userId,
        `🗜️ Resumí ${toSummarize.length} mensajes anteriores para mantener el contexto limpio.`,
        { threadId }
      )
    } catch {
      // Non-critical — don't break the flow if notification fails
    }
  }
}

/**
 * Clear old tool results in-memory to reduce tokens before a model call.
 * Does NOT modify the database — only the in-memory messages array.
 * 
 * Strategy: COMPRESS (Context Engineering)
 * - Replaces old tool results with short summaries
 * - Keeps recent tool results intact (keepLastN)
 * - Uses TOON format for compact representation
 */
export function clearOldToolResults<T extends { role: string; content: string | ContentPart[] }>(
  messages: T[],
  keepLastN = 6
): T[] {
  if (messages.length <= keepLastN) return messages
  const cutoffIndex = messages.length - keepLastN

  return messages.map((msg, i) => {
    if (i >= cutoffIndex) return msg
    
    if (msg.role === "tool" && typeof msg.content === "string") {
      // For tool results older than keepLastN, summarize
      if (msg.content.length > TOOL_RESULT_MAX_CHARS) {
        // Try to extract key info from TOON/JSON format
        let summary = msg.content.substring(0, TOOL_RESULT_MAX_CHARS)
        
        // If it looks like JSON/TOON, add a marker
        if (msg.content.trim().startsWith('{') || msg.content.trim().includes(':')) {
          summary = `[Tool result summarized: ${summary}...]`
        } else {
          summary = `[Result truncated: ${summary}...]`
        }
        
        return {
          ...msg,
          content: summary,
        }
      }
    }
    
    return msg
  })
}

