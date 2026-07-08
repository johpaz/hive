/**
 * Conversation Store — persists message history in the `conversations` table.
 * Replaces the LangGraph BunSqliteSaver + lg_checkpoints approach.
 *
 * Also manages: summaries (SQLite), scratchpad (HiveDB collection — first
 * table migrated off SQLite onto @johpaz/hive-db's document collections).
 */

import { getDb } from "../storage/sqlite"
import { getSearchDb } from "../storage/hivedb"
import { logger } from "../utils/logger"
import type { LLMMessage, ContentPart } from "./llm-client"
import { estimateTokens } from "../utils/toon"

const log = logger.child("conv-store")

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoredMessage {
  id: number
  thread_id: string
  channel: string
  role: "user" | "assistant" | "tool" | "system"
  content: string
  tool_calls_json: string | null
  tool_call_id: string | null
  reasoning_content: string | null  // Kimi K2 thinking — must be round-tripped
  content_multimodal: string | null // JSON array of ContentPart[]
  token_count: number
  created_at: number
}

// ─── Message operations ───────────────────────────────────────────────────────

export function addMessage(
  threadId: string,
  role: StoredMessage["role"],
  content: string | ContentPart[],
  opts?: {
    channel?: string
    tool_calls?: LLMMessage["tool_calls"]
    tool_call_id?: string
    reasoning_content?: string
  }
): number {
  const db = getDb()
  // Handle multimodal content by extracting text for the content column
  const textContent = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.filter(p => p.type === "text").map(p => (p as any).text).join("\n")
      : String(content)

  const content_multimodal = Array.isArray(content) ? JSON.stringify(content) : null
  const tool_calls_json = opts?.tool_calls ? JSON.stringify(opts.tool_calls) : null

  const result = db.query(`
    INSERT INTO conversations (thread_id, channel, role, content, content_multimodal, tool_calls_json, tool_call_id, reasoning_content, token_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    RETURNING id
  `).get(
    threadId,
    opts?.channel ?? "webchat",
    role,
    textContent,
    content_multimodal,
    tool_calls_json,
    opts?.tool_call_id ?? null,
    opts?.reasoning_content ?? null,
    // Estimate tokens: content + tool_calls JSON
    Math.max(1, estimateTokens(textContent) + estimateTokens(tool_calls_json ?? "")),
  ) as { id: number }

  return result.id
}

/**
 * Returns all messages for the thread ordered oldest → newest.
 */
export function getHistory(threadId: string, limit = 200): StoredMessage[] {
  const db = getDb()
  return db.query(`
    SELECT * FROM conversations
    WHERE thread_id = ?
    ORDER BY id ASC
    LIMIT ?
  `).all(threadId, limit) as StoredMessage[]
}

/**
 * Returns only the last N messages (oldest → newest order),
 * with leading orphaned tool messages stripped from the window start.
 *
 * A tool message is "orphaned" when the assistant message that issued its
 * tool_call_id is not present in the loaded window (it was compacted away).
 * Sending orphaned tool messages to the LLM causes provider errors.
 */
export function getRecentMessages(threadId: string, n: number): StoredMessage[] {
  const db = getDb()
  const rows = db.query(`
    SELECT * FROM conversations
    WHERE thread_id = ? AND role != 'tool'
    ORDER BY id DESC
    LIMIT ?
  `).all(threadId, n) as StoredMessage[]
  return stripLeadingOrphanedTools(rows.reverse())
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

export function getMessageCount(threadId: string): number {
  const db = getDb()
  const row = db.query(
    "SELECT COUNT(*) as cnt FROM conversations WHERE thread_id = ?"
  ).get(threadId) as { cnt: number }
  return row.cnt
}

export function getTotalTokens(threadId: string): number {
  const db = getDb()
  const row = db.query(
    "SELECT COALESCE(SUM(token_count), 0) as total FROM conversations WHERE thread_id = ?"
  ).get(threadId) as { total: number }
  return row.total
}

/**
 * Messages after a given message ID (for incremental summary updates).
 */
export function getMessagesAfter(threadId: string, afterId: number): StoredMessage[] {
  const db = getDb()
  return db.query(`
    SELECT * FROM conversations
    WHERE thread_id = ? AND id > ?
    ORDER BY id ASC
  `).all(threadId, afterId) as StoredMessage[]
}

// ─── Convert stored messages → LLMMessage array ───────────────────────────────

export function toAPIMessages(rows: StoredMessage[]): LLMMessage[] {
  return rows.map((r) => {
    let content: string | ContentPart[] = r.content
    if (r.content_multimodal) {
      try { content = JSON.parse(r.content_multimodal) } catch { /* ignore */ }
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

export function getSummary(threadId: string): Summary | null {
  const db = getDb()
  return db.query(
    "SELECT summary, last_message_id, messages_covered FROM summaries WHERE thread_id = ?"
  ).get(threadId) as Summary | null
}

export function saveSummary(
  threadId: string,
  summary: string,
  messagesCovered: number,
  lastMessageId: number
): void {
  const db = getDb()
  db.query(`
    INSERT INTO summaries (thread_id, summary, messages_covered, last_message_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      summary        = excluded.summary,
      messages_covered = excluded.messages_covered,
      last_message_id  = excluded.last_message_id,
      updated_at       = unixepoch()
  `).run(threadId, summary, messagesCovered, lastMessageId)
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
  const db = await getSearchDb()
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
