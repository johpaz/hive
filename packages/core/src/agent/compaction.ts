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
  getHistory,
  getSummary,
  saveSummary,
  toAPIMessages,
  getMessageCount,
} from "./conversation-store"
import { estimateTokens } from "../utils/toon"
import { callLLM, resolveProviderConfig, type ContentPart } from "./llm-client"
import { getDb } from "../storage/sqlite"

const log = logger.child("compaction")

// Token budget: compress when stored tokens exceed this threshold
const COMPACT_TOKEN_THRESHOLD = 6000   // ~60% of 10K context window
const KEEP_LAST_N_MESSAGES = 5         // always keep most recent N messages
const TOOL_RESULT_MAX_CHARS = 200      // max chars for old tool results after clearing
const MAX_TRANSCRIPT_MSGS = 30         // cap messages sent to summarizer (avoids OOM on small models)
const MAX_MSG_CHARS = 300              // chars per message in transcript

/**
 * Check if compaction is needed and run it if so.
 * Called at the start of each agent loop iteration.
 */
export async function maybeCompact(
  threadId: string,
  notify?: { channel: string; userId: string }
): Promise<void> {
  try {
    const totalTokens = getTotalTokens(threadId)
    if (totalTokens < COMPACT_TOKEN_THRESHOLD) return

    const summary = getSummary(threadId)
    const totalMessages = getMessageCount(threadId)

    // Already summarized up to near the current state
    if (summary && summary.last_message_id > totalMessages - KEEP_LAST_N_MESSAGES) return

    log.info(`[compaction] Compacting thread=${threadId} tokens=${totalTokens}`)
    await compactThread(threadId, notify)
  } catch (err) {
    log.warn("[compaction] Error during compaction check:", err)
  }
}

/**
 * Compress a thread's history into a summary.
 */
export async function compactThread(
  threadId: string,
  notify?: { channel: string; userId: string }
): Promise<void> {
  const allMessages = getHistory(threadId)
  if (allMessages.length <= KEEP_LAST_N_MESSAGES) return

  // Find a clean cut point: the "keep" side must begin with a user turn so
  // we never leave orphaned tool messages at the start of the visible window.
  let cutIndex = allMessages.length - KEEP_LAST_N_MESSAGES
  while (cutIndex > 0 && allMessages[cutIndex]?.role !== "user") {
    cutIndex--
  }
  if (cutIndex <= 0) {
    log.info(`[compaction] No clean user-turn boundary found — skipping`)
    return
  }

  const toSummarize = allMessages.slice(0, cutIndex)
  if (toSummarize.length === 0) return

  const lastSummarizedId = toSummarize[toSummarize.length - 1].id

  const existingSummary = getSummary(threadId)
  if (existingSummary && existingSummary.last_message_id >= lastSummarizedId) return

  // Cap transcript to avoid overflowing small model contexts
  const capped = toSummarize.slice(-MAX_TRANSCRIPT_MSGS)
  const apiMessages = toAPIMessages(capped)
  const transcript = apiMessages
    .map((m) => {
      const text = typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.filter(p => p.type === "text").map(p => (p as any).text).join("\n")
          : ""
      return `[${m.role.toUpperCase()}]: ${text.substring(0, MAX_MSG_CHARS)}`
    })
    .join("\n\n")

  const db = getDb()
  const coordinator = db.query<any, []>(
    "SELECT provider_id, model_id FROM agents WHERE role = 'coordinator' LIMIT 1"
  ).get()

  const providerCfg = await resolveProviderConfig(
    coordinator?.provider_id || "openai",
    coordinator?.model_id || "gpt-4o-mini"
  )

  const summaryResponse = await callLLM({
    ...providerCfg,
    messages: [
      {
        role: "system",
        content:
          "You are a conversation summarizer. Create a concise summary preserving: " +
          "user preferences, decisions made, important facts, tool results, and context needed to continue.",
      },
      {
        role: "user",
        content: `Summarize this conversation (${toSummarize.length} messages) in 3-5 sentences:\n\n${transcript}`,
      },
    ],
  })

  const summary = summaryResponse.content.trim()
  if (!summary) return

  saveSummary(threadId, summary, toSummarize.length, lastSummarizedId)
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
        `🗜️ Resumí ${toSummarize.length} mensajes anteriores para mantener el contexto limpio.`
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

/**
 * Summarize a tool result to a single line
 * Used for very old tool results (> 10 turns)
 */
export function summarizeToolResult(content: string, toolName?: string): string {
  // Try to extract success/failure status
  const isError = content.includes('error') || content.includes('failed') || content.startsWith('[Tool Error]')
  const isSuccess = content.includes('ok') || content.includes('success') || content.includes('true')
  
  // Try to extract key result field from JSON/TOON
  let keyInfo = ""
  try {
    // Simple extraction of first key value
    const firstLine = content.split('\n')[0].substring(0, 80)
    keyInfo = firstLine
  } catch {
    keyInfo = content.substring(0, 80)
  }
  
  const status = isError ? "failed" : isSuccess ? "success" : "completed"
  return `[${toolName || 'Tool'} ${status}: ${keyInfo}...]`
}
