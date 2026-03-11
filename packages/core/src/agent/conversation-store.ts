/**
 * Conversation Store — persists message history in the `conversations` table.
 * Replaces the LangGraph BunSqliteSaver + lg_checkpoints approach.
 *
 * Also manages: summaries, scratchpad.
 */

import { getDb } from "../storage/sqlite"
import { logger } from "../utils/logger"
import type { LLMMessage } from "./llm-client"
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
  token_count: number
  created_at: number
}

// ─── Message operations ───────────────────────────────────────────────────────

export function addMessage(
  threadId: string,
  role: StoredMessage["role"],
  content: string,
  opts?: {
    channel?: string
    tool_calls?: LLMMessage["tool_calls"]
    tool_call_id?: string
  }
): number {
  const db = getDb()
  const tool_calls_json = opts?.tool_calls?.length
    ? JSON.stringify(opts.tool_calls)
    : null

  const result = db.query(`
    INSERT INTO conversations (thread_id, channel, role, content, tool_calls_json, tool_call_id, token_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    RETURNING id
  `).get(
    threadId,
    opts?.channel ?? "webchat",
    role,
    content,
    tool_calls_json,
    opts?.tool_call_id ?? null,
    estimateTokens(content) + estimateTokens(tool_calls_json ?? ""),
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
 * Returns only the last N messages (oldest → newest order).
 */
export function getRecentMessages(threadId: string, n: number): StoredMessage[] {
  const db = getDb()
  const rows = db.query(`
    SELECT * FROM conversations
    WHERE thread_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(threadId, n) as StoredMessage[]
  return rows.reverse()
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
    const msg: LLMMessage = { role: r.role, content: r.content }
    if (r.tool_calls_json) {
      try { msg.tool_calls = JSON.parse(r.tool_calls_json) } catch { /* ignore */ }
    }
    if (r.tool_call_id) msg.tool_call_id = r.tool_call_id
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

// ─── Scratchpad ───────────────────────────────────────────────────────────────

export function saveScratchpadNote(
  threadId: string,
  key: string,
  value: string,
  source?: string
): void {
  const db = getDb()
  db.query(`
    INSERT INTO scratchpad (thread_id, key, value, source)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(thread_id, key) DO UPDATE SET
      value      = excluded.value,
      source     = excluded.source,
      updated_at = unixepoch()
  `).run(threadId, key, value, source ?? null)
}

export function getScratchpad(threadId: string): Array<{ key: string; value: string }> {
  const db = getDb()
  return db.query(
    "SELECT key, value FROM scratchpad WHERE thread_id = ? ORDER BY updated_at DESC"
  ).all(threadId) as Array<{ key: string; value: string }>
}

export function deleteScratchpadNote(threadId: string, key: string): void {
  const db = getDb()
  db.query("DELETE FROM scratchpad WHERE thread_id = ? AND key = ?").run(threadId, key)
}
