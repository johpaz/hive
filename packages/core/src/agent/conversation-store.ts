/**
 * Conversation Store — persists message history in the `conversations` HiveDB collection.
 * Replaces the LangGraph BunSqliteSaver + lg_checkpoints approach.
 *
 * Also manages: summaries and scratchpad, both HiveDB document collections.
 */

import { col, nextId, bumpRollup } from "../storage/hive"
import { getHiveDb } from "../storage/hivedb"
import { logger } from "../utils/logger"
import type { LLMMessage, ContentPart } from "./llm-client"
import { estimateTokens } from "../utils/toon"
import type { ConversationDoc, SummaryDoc, MessageSource } from "../storage/collections"

const log = logger.child("conv-store")

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoredMessage {
  /** Per-thread monotonic sequence number (NOT globally unique — scope every comparison to a single threadId). */
  id: number
  thread_id: string
  channel: string
  role: "user" | "assistant" | "tool"
  /** Provenance of this turn. Never null — legacy rows are normalized to "legacy_internal" on read. */
  source: MessageSource
  content: string
  tool_calls_json: string | null
  tool_call_id: string | null
  reasoning_content: string | null  // Kimi K2 thinking — must be round-tripped
  content_multimodal: string | null // JSON array of ContentPart[]
  token_count: number
  created_at: number
}

// ─── Internal events (delegation fan-in, etc.) ────────────────────────────────
//
// These are system-authored turns (async delegation outcomes) that must reach
// the model as input but must never be persisted with role:"system" — doing so
// causes every LLM provider to hoist them permanently into the system
// instruction on every subsequent turn (see gemini.ts/anthropic.ts, which
// concatenate ALL role:"system" messages into systemInstruction/system). They
// are persisted as role:"user" + a source tag instead, and wrapped with a
// framing marker only at serialization time (toAPIMessages), so stored content
// stays clean and the wording can evolve without a migration.

export const INTERNAL_SOURCES: ReadonlySet<string> =
  new Set(["task_complete", "delegation_summary", "legacy_internal"])

export function isInternalSource(source: string | null | undefined): boolean {
  return !!source && INTERNAL_SOURCES.has(source)
}

export function formatInternalEvent(source: string, content: string): string {
  return `<hive:internal_event source="${source}">\n` +
    `Evento interno del sistema — NO es un mensaje del usuario. No lo cites literalmente, no expongas IDs internos (task_id, worker_id, verification_id) ni JSON crudo. Respondé al usuario de forma natural y breve.\n\n` +
    `${content}\n` +
    `</hive:internal_event>`
}

function storageId(threadId: string, seq: number): string {
  return `${threadId}:${String(seq).padStart(15, "0")}`
}

function toStoredMessage(id: string, doc: ConversationDoc): StoredMessage {
  const seq = parseInt(id.slice(id.lastIndexOf(":") + 1), 10)
  // Legacy rows (written before `source` existed) used role:"system" as the
  // sole marker for internal events. Normalize them here so every downstream
  // reader (getRecentMessages, compaction, context-compiler) sees a single
  // consistent shape and never has to special-case role:"system" again.
  const legacyInternal = doc.role === "system"
  return {
    id: seq,
    thread_id: doc.thread_id,
    channel: doc.channel,
    role: legacyInternal ? "user" : (doc.role as StoredMessage["role"]),
    source: doc.source ?? (legacyInternal ? "legacy_internal" : "message"),
    content: doc.content,
    tool_calls_json: doc.tool_calls_json,
    tool_call_id: doc.tool_call_id,
    reasoning_content: doc.reasoning_content,
    content_multimodal: doc.content_multimodal,
    token_count: doc.token_count,
    created_at: doc.created_at,
  }
}

// ─── Message operations ───────────────────────────────────────────────────────

const recentMessageTimestamps: number[] = []

export function getRecentMessageCount(windowMs = 5 * 60_000): number {
  const cutoff = Date.now() - windowMs
  while (recentMessageTimestamps.length && recentMessageTimestamps[0] < cutoff) {
    recentMessageTimestamps.shift()
  }
  return recentMessageTimestamps.length
}

export async function addMessage(
  threadId: string,
  role: StoredMessage["role"],
  content: string | ContentPart[],
  opts?: {
    channel?: string
    tool_calls?: LLMMessage["tool_calls"]
    tool_call_id?: string
    reasoning_content?: string
    source?: MessageSource
  }
): Promise<number> {
  // Handle multimodal content by extracting text for the content column
  const textContent = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.filter(p => p.type === "text").map(p => (p as any).text).join("\n")
      : String(content)

  const content_multimodal = Array.isArray(content) ? JSON.stringify(content) : null
  const tool_calls_json = opts?.tool_calls ? JSON.stringify(opts.tool_calls) : null

  const paddedSeq = await nextId(`conversations:${threadId}`)
  const seq = parseInt(paddedSeq, 10)
  const now = Date.now()

  const conversationsCol = await col<ConversationDoc>("conversations")
  await conversationsCol.put(storageId(threadId, seq), {
    id: storageId(threadId, seq),
    thread_id: threadId,
    channel: opts?.channel ?? "webchat",
    role,
    content: textContent,
    content_multimodal,
    tool_calls_json,
    tool_call_id: opts?.tool_call_id ?? null,
    reasoning_content: opts?.reasoning_content ?? null,
    source: opts?.source ?? "message",
    // Estimate tokens: content + tool_calls JSON
    token_count: Math.max(1, estimateTokens(textContent) + estimateTokens(tool_calls_json ?? "")),
    created_at: now,
    updated_at: now,
  }, { expectedVersion: 0 })

  // Fire-and-forget — never block message persistence on the activity chart rollup.
  const hour = new Date(now).toISOString().slice(0, 13)
  bumpRollup("activityRollups", hour, { messageCount: 1 }).catch(() => {})
  recentMessageTimestamps.push(now)

  return seq
}

/**
 * Returns all messages for the thread ordered oldest → newest.
 */
export async function getHistory(threadId: string, limit = 200): Promise<StoredMessage[]> {
  const conversationsCol = await col<ConversationDoc>("conversations")
  const entries = await conversationsCol.scan({ prefix: `${threadId}:`, limit })
  return entries.map(e => toStoredMessage(e.id, e.doc))
}

/**
 * Returns only the last N messages (oldest → newest order),
 * with leading orphaned tool messages stripped from the window start.
 *
 * A tool message is "orphaned" when the assistant message that issued its
 * tool_call_id is not present in the loaded window (it was compacted away).
 * Sending orphaned tool messages to the LLM causes provider errors.
 */
export async function getRecentMessages(threadId: string, n: number): Promise<StoredMessage[]> {
  const conversationsCol = await col<ConversationDoc>("conversations")
  const entries = await conversationsCol.scan({ prefix: `${threadId}:`, reverse: true })
  const nonTool = entries.filter(e => e.doc.role !== "tool").slice(0, n)
  const rows = nonTool.map(e => toStoredMessage(e.id, e.doc)).reverse()
  return stripLeadingOrphanedTools(rows)
}

function stripLeadingOrphanedTools(rows: StoredMessage[]): StoredMessage[] {
  // Collect all tool_call_ids referenced by assistant messages in this window
  const knownIds = new Set<string>()
  for (const r of rows) {
    if (r.role === "assistant" && r.tool_calls_json) {
      try {
        const tcs = JSON.parse(r.tool_calls_json) as Array<{ id: string }>
        for (const tc of tcs) knownIds.add(tc.id)
      } catch { /* ignore malformed JSON */ }
    }
  }

  // Drop tool messages at the start of the window whose assistant is missing
  let start = 0
  while (
    start < rows.length &&
    rows[start].role === "tool" &&
    rows[start].tool_call_id !== null &&
    !knownIds.has(rows[start].tool_call_id!)
  ) {
    start++
  }

  if (start > 0) {
    log.warn(`[conv-store] Stripped ${start} leading orphaned tool message(s) from window (tool_call_ids outside window)`)
  }
  return start > 0 ? rows.slice(start) : rows
}

export async function getMessageCount(threadId: string): Promise<number> {
  const conversationsCol = await col<ConversationDoc>("conversations")
  const entries = await conversationsCol.scan({ prefix: `${threadId}:` })
  return entries.length
}

export async function getTotalTokens(threadId: string): Promise<number> {
  const conversationsCol = await col<ConversationDoc>("conversations")
  const entries = await conversationsCol.scan({ prefix: `${threadId}:` })
  return entries.reduce((sum, e) => sum + e.doc.token_count, 0)
}

/**
 * Messages after a given message ID (for incremental summary updates).
 */
export async function getMessagesAfter(threadId: string, afterId: number): Promise<StoredMessage[]> {
  const conversationsCol = await col<ConversationDoc>("conversations")
  const entries = await conversationsCol.scan({ prefix: `${threadId}:` })
  return entries
    .map(e => toStoredMessage(e.id, e.doc))
    .filter(m => m.id > afterId)
}

// ─── Convert stored messages → LLMMessage array ───────────────────────────────

export function toAPIMessages(rows: StoredMessage[]): LLMMessage[] {
  return rows.map((r) => {
    let content: string | ContentPart[] = r.content
    if (r.content_multimodal) {
      try { content = JSON.parse(r.content_multimodal) } catch { /* ignore */ }
    }
    // Internal events (delegation fan-in) are wrapped at serialization time —
    // never at authoring time — so stored content stays clean and legacy rows
    // (normalized to source:"legacy_internal" in toStoredMessage) get wrapped
    // for free. Internal events are never multimodal in practice.
    if (isInternalSource(r.source) && typeof content === "string") {
      content = formatInternalEvent(r.source, content)
    }
    const msg: LLMMessage = { role: r.role, content }
    // Note: tool_calls and tool_call_id are NOT reconstructed from DB.
    // Tool results are kept in-memory during iteration but not persisted,
    // so historical messages only contain text conversation.
    if (r.reasoning_content) msg.reasoning_content = r.reasoning_content
    return msg
  })
}

// ─── Summaries ────────────────────────────────────────────────────────────────

export interface Summary {
  summary: string
  last_message_id: number
  messages_covered: number
}

export async function getSummary(threadId: string): Promise<Summary | null> {
  const summariesCol = await col<SummaryDoc>("summaries")
  const entry = await summariesCol.get(threadId)
  if (!entry) return null
  return {
    summary: entry.doc.summary,
    last_message_id: entry.doc.last_message_id ? parseInt(entry.doc.last_message_id, 10) : 0,
    messages_covered: entry.doc.messages_covered,
  }
}

export async function saveSummary(
  threadId: string,
  summary: string,
  messagesCovered: number,
  lastMessageId: number
): Promise<void> {
  const summariesCol = await col<SummaryDoc>("summaries")
  const existing = await summariesCol.get(threadId)
  await summariesCol.put(threadId, {
    thread_id: threadId,
    summary,
    messages_covered: messagesCovered,
    last_message_id: String(lastMessageId),
  }, existing ? { expectedVersion: existing.version } : { expectedVersion: 0 })
}

// ─── Scratchpad (HiveDB collection) ────────────────────────────────────────────
//
// Persistent key-value notes per conversation. Lives in a HiveDB document
// collection instead of SQLite: id = "<threadId>:<key>", so a per-thread
// listing is a prefix scan and no secondary index is needed.

export interface ScratchpadDoc {
  threadId: string
  key: string
  value: string
  source: string | null
  createdAt: number
  updatedAt: number
  /** Monotonic per-process counter — tiebreaker for notes saved within the same clock tick. */
  seq: number
}

let scratchpadSeq = 0

/** Wire shape for the admin notes panel — mirrors the old SQLite row (snake_case, epoch seconds). */
export interface ScratchpadNoteRow {
  id: string
  thread_id: string
  key: string
  value: string
  source: string | null
  created_at: number
  updated_at: number
}

function scratchpadNoteId(threadId: string, key: string): string {
  return `${threadId}:${key}`
}

async function scratchpadCollection() {
  const db = await getHiveDb()
  return db.collection<ScratchpadDoc>("scratchpad")
}

export async function saveScratchpadNote(
  threadId: string,
  key: string,
  value: string,
  source?: string
): Promise<void> {
  const col = await scratchpadCollection()
  const id = scratchpadNoteId(threadId, key)
  const existing = await col.get(id)
  const now = Date.now()
  await col.put(id, {
    threadId,
    key,
    value,
    source: source ?? null,
    createdAt: existing?.doc.createdAt ?? now,
    updatedAt: now,
    seq: scratchpadSeq++,
  })
}

function byMostRecent(a: { doc: ScratchpadDoc }, b: { doc: ScratchpadDoc }): number {
  return b.doc.updatedAt - a.doc.updatedAt || b.doc.seq - a.doc.seq
}

export async function getScratchpad(threadId: string): Promise<Array<{ key: string; value: string }>> {
  const col = await scratchpadCollection()
  const entries = await col.scan({ prefix: `${threadId}:` })
  return entries
    .sort(byMostRecent)
    .map((e) => ({ key: e.doc.key, value: e.doc.value }))
}

/** All notes across every thread, most recently updated first — used by the admin notes panel. */
export async function listAllScratchpadNotes(limit: number): Promise<ScratchpadNoteRow[]> {
  const col = await scratchpadCollection()
  const entries = await col.scan({})
  return entries
    .sort(byMostRecent)
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      thread_id: e.doc.threadId,
      key: e.doc.key,
      value: e.doc.value,
      source: e.doc.source,
      created_at: Math.floor(e.doc.createdAt / 1000),
      updated_at: Math.floor(e.doc.updatedAt / 1000),
    }))
}

export async function deleteScratchpadNote(threadId: string, key: string): Promise<void> {
  const col = await scratchpadCollection()
  await col.delete(scratchpadNoteId(threadId, key))
}
