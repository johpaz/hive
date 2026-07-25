/**
 * Pure-function tests for compaction.ts's cut-point and transcript-rendering
 * helpers — extracted so they're testable without a real LLM call
 * (compactThread() itself calls callLLM and needs network).
 */

import { describe, test, expect } from "bun:test";
import { findCompactionCutIndex, renderTranscript } from "../packages/core/src/agent/compaction";
import type { StoredMessage } from "../packages/core/src/agent/conversation-store";

function msg(partial: Partial<StoredMessage> & Pick<StoredMessage, "id" | "role" | "content">): StoredMessage {
  return {
    thread_id: "t",
    channel: "webchat",
    source: "message",
    tool_calls_json: null,
    tool_call_id: null,
    reasoning_content: null,
    content_multimodal: null,
    token_count: 1,
    created_at: Date.now(),
    ...partial,
  };
}

describe("findCompactionCutIndex", () => {
  test("finds a clean user-turn boundary near the end of the history", () => {
    const rows: StoredMessage[] = [
      msg({ id: 1, role: "user", content: "a" }),
      msg({ id: 2, role: "assistant", content: "b" }),
      msg({ id: 3, role: "user", content: "c" }),
      msg({ id: 4, role: "assistant", content: "d" }),
      msg({ id: 5, role: "user", content: "e" }),
      msg({ id: 6, role: "assistant", content: "f" }),
      msg({ id: 7, role: "user", content: "g" }),
    ];

    // keepLastN=3 -> naive cut at index 4 (rows[4].role === "user") — already clean.
    expect(findCompactionCutIndex(rows, 3)).toBe(4);
  });

  test("walks back to the nearest user turn when the naive cut lands on assistant", () => {
    const rows: StoredMessage[] = [
      msg({ id: 1, role: "user", content: "a" }),
      msg({ id: 2, role: "user", content: "b" }), // internal event, still role:user
      msg({ id: 3, role: "assistant", content: "c" }),
      msg({ id: 4, role: "assistant", content: "d" }),
    ];

    // keepLastN=1 -> naive cut at index 3 (assistant) -> walk back to index 1 (user).
    expect(findCompactionCutIndex(rows, 1)).toBe(1);
  });

  test("a tail of internal events (role:user) does not block the cut point", () => {
    const rows: StoredMessage[] = [
      msg({ id: 1, role: "user", content: "a" }),
      msg({ id: 2, role: "assistant", content: "b" }),
      msg({ id: 3, role: "user", content: "El agente completó la tarea X.", source: "task_complete" }),
      msg({ id: 4, role: "user", content: "El agente completó la tarea Y.", source: "delegation_summary" }),
    ];

    // keepLastN=2 -> naive cut at index 2, which IS a user turn (the internal
    // event) — before source-based framing existed, this was persisted as
    // role:"system" and would have blocked the cut entirely.
    expect(findCompactionCutIndex(rows, 2)).toBe(2);
  });

  test("returns 0 when no clean boundary exists (caller should skip compaction)", () => {
    const rows: StoredMessage[] = [
      msg({ id: 1, role: "assistant", content: "a" }),
      msg({ id: 2, role: "assistant", content: "b" }),
    ];

    expect(findCompactionCutIndex(rows, 1)).toBe(0);
  });
});

describe("renderTranscript", () => {
  test("labels normal rows by role", () => {
    const rows: StoredMessage[] = [
      msg({ id: 1, role: "user", content: "hola" }),
      msg({ id: 2, role: "assistant", content: "¿en qué te ayudo?" }),
    ];

    const transcript = renderTranscript(rows);
    expect(transcript).toContain("[USER]: hola");
    expect(transcript).toContain("[ASSISTANT]: ¿en qué te ayudo?");
  });

  test("labels internal-source rows [EVENTO INTERNO], never [USER]", () => {
    const rows: StoredMessage[] = [
      msg({ id: 1, role: "user", content: "El agente completó la tarea X.", source: "task_complete" }),
    ];

    const transcript = renderTranscript(rows);
    expect(transcript).toContain("[EVENTO INTERNO]: El agente completó la tarea X.");
    expect(transcript).not.toContain("[USER]");
  });

  test("truncates each message to maxMsgChars", () => {
    const rows: StoredMessage[] = [msg({ id: 1, role: "user", content: "x".repeat(500) })];
    const transcript = renderTranscript(rows, 10);
    expect(transcript).toBe(`[USER]: ${"x".repeat(10)}`);
  });
});
