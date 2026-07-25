/**
 * Internal-event turns (delegation fan-in) must persist as role:"user" + a
 * `source` tag — never role:"system" — so every LLM provider that hoists
 * ALL role:"system" messages into a single system instruction (Gemini,
 * Anthropic) can't accidentally promote a transient delegation notice into a
 * permanent standing instruction. See conversation-store.ts's
 * isInternalSource/formatInternalEvent and routes/chat.ts's history filter.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId } from "../packages/core/src/storage/boot-id";
import { col } from "../packages/core/src/storage/hive";
import {
  addMessage,
  getRecentMessages,
  toAPIMessages,
  isInternalSource,
  formatInternalEvent,
} from "../packages/core/src/agent/conversation-store";
import { handleGetChatHistory } from "../packages/core/src/gateway/routes/chat";
import type { ConversationDoc } from "../packages/core/src/storage/collections";

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

describe("internal turns: persistence", () => {
  test("addMessage with source persists role:user + the given source", async () => {
    await addMessage("thread-a", "user", "El agente completó la tarea X.", {
      source: "task_complete",
    });

    const conversationsCol = await col<ConversationDoc>("conversations");
    const entries = await conversationsCol.scan({ prefix: "thread-a:" });
    expect(entries).toHaveLength(1);
    expect(entries[0].doc.role).toBe("user");
    expect(entries[0].doc.source).toBe("task_complete");
  });

  test("normal messages persist source:message by default", async () => {
    await addMessage("thread-b", "user", "hola");

    const conversationsCol = await col<ConversationDoc>("conversations");
    const entries = await conversationsCol.scan({ prefix: "thread-b:" });
    expect(entries[0].doc.source).toBe("message");
  });
});

describe("internal turns: serialization (toAPIMessages)", () => {
  test("wraps internal-source content in the <hive:internal_event> marker", async () => {
    await addMessage("thread-c", "user", "El agente completó la tarea X.", {
      source: "task_complete",
    });

    const rows = await getRecentMessages("thread-c", 10);
    const apiMessages = toAPIMessages(rows);

    expect(apiMessages).toHaveLength(1);
    expect(apiMessages[0].role).toBe("user");
    expect(apiMessages[0].content).toContain('<hive:internal_event source="task_complete">');
    expect(apiMessages[0].content).toContain("El agente completó la tarea X.");
  });

  test("leaves normal user/assistant content untouched", async () => {
    await addMessage("thread-d", "user", "hola");
    await addMessage("thread-d", "assistant", "¿en qué te ayudo?");

    const rows = await getRecentMessages("thread-d", 10);
    const apiMessages = toAPIMessages(rows);

    expect(apiMessages[0].content).toBe("hola");
    expect(apiMessages[1].content).toBe("¿en qué te ayudo?");
  });

  test("regression guard: a mix of user/assistant/internal rows never yields role:system", async () => {
    await addMessage("thread-e", "user", "Delegá esto");
    await addMessage("thread-e", "assistant", "Listo, delegado.");
    await addMessage("thread-e", "user", "El agente completó la tarea X.", {
      source: "task_complete",
    });
    await addMessage("thread-e", "assistant", "El worker terminó la tarea X.");

    const rows = await getRecentMessages("thread-e", 10);
    const apiMessages = toAPIMessages(rows);

    expect(apiMessages).toHaveLength(4);
    expect(apiMessages.every((m) => m.role !== "system")).toBe(true);
  });
});

describe("internal turns: public history endpoint", () => {
  async function fetchHistory(sessionId: string) {
    const req = new Request(`http://localhost/api/chat/history?sessionId=${sessionId}`);
    const res = await handleGetChatHistory(req, (r) => r);
    return (await res.json()) as { messages: Array<{ role: string; content: string }> };
  }

  test("excludes internal-source rows, keeps user/assistant", async () => {
    await addMessage("thread-f", "user", "hola");
    await addMessage("thread-f", "assistant", "¿en qué te ayudo?");
    await addMessage("thread-f", "user", "El agente completó la tarea X.", {
      source: "task_complete",
    });

    const { messages } = await fetchHistory("thread-f");

    expect(messages).toHaveLength(2);
    expect(messages.map((m) => m.content)).toEqual(["hola", "¿en qué te ayudo?"]);
  });
});

describe("internal turns: legacy role:system compat", () => {
  async function writeLegacySystemRow(threadId: string, content: string) {
    // Pre-`source` rows used role:"system" as the sole marker for internal
    // events; source didn't exist yet (persisted as absent/null).
    await addMessage(threadId, "user", content); // reserves the id/seq
    const conversationsCol = await col<ConversationDoc>("conversations");
    const entries = await conversationsCol.scan({ prefix: `${threadId}:` });
    // Target the row just added, not the thread's first row — a thread may
    // already have earlier messages when this helper runs.
    const { id, version, doc } = entries[entries.length - 1];
    await conversationsCol.put(id, { ...doc, role: "system", source: null }, { expectedVersion: version });
  }

  test("getRecentMessages normalizes legacy role:system rows to user/legacy_internal", async () => {
    await writeLegacySystemRow("thread-g", "[Sistema] aviso viejo");

    const rows = await getRecentMessages("thread-g", 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("user");
    expect(rows[0].source).toBe("legacy_internal");
  });

  test("toAPIMessages wraps legacy rows the same as current internal events", async () => {
    await writeLegacySystemRow("thread-h", "[Sistema] aviso viejo");

    const rows = await getRecentMessages("thread-h", 10);
    const apiMessages = toAPIMessages(rows);

    expect(apiMessages[0].role).toBe("user");
    expect(apiMessages[0].content).toContain('<hive:internal_event source="legacy_internal">');
  });

  test("handleGetChatHistory excludes legacy role:system rows", async () => {
    await addMessage("thread-i", "user", "hola");
    await writeLegacySystemRow("thread-i", "[Sistema] aviso viejo");

    const req = new Request("http://localhost/api/chat/history?sessionId=thread-i");
    const res = await handleGetChatHistory(req, (r) => r);
    const { messages } = (await res.json()) as { messages: Array<{ content: string }> };

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("hola");
  });
});

describe("isInternalSource / formatInternalEvent", () => {
  test("recognizes task_complete, delegation_summary, legacy_internal — nothing else", () => {
    expect(isInternalSource("task_complete")).toBe(true);
    expect(isInternalSource("delegation_summary")).toBe(true);
    expect(isInternalSource("legacy_internal")).toBe(true);
    expect(isInternalSource("message")).toBe(false);
    expect(isInternalSource("api")).toBe(false);
    expect(isInternalSource(null)).toBe(false);
    expect(isInternalSource(undefined)).toBe(false);
  });

  test("formatInternalEvent frames content with the source and a non-citation instruction", () => {
    const wrapped = formatInternalEvent("task_complete", "resultado X");
    expect(wrapped).toContain('source="task_complete"');
    expect(wrapped).toContain("resultado X");
    expect(wrapped).toContain("NO es un mensaje del usuario");
  });
});
