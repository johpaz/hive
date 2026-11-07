/**
 * conversation_read: lectura selectiva del historial, incluido lo ya compactado.
 * HIVE_DB_PATH=":memory:" para no dejar estado.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { addMessage, getHistory } from "../packages/core/src/agent/conversation-store";
import { indexThreadMessages } from "../packages/core/src/agent/message-memory";
import { conversationReadTool } from "../packages/core/src/tools/core/index";

const THREAD = "u/web/a";
const cfg = { configurable: { thread_id: THREAD } } as any;

type ReadResult = { ok: boolean; error?: string; messages?: Array<{ id: number; content: string }> };
const read = (params: Record<string, unknown>, config: any = cfg) =>
  conversationReadTool.execute(params, config) as Promise<ReadResult>;

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
  await addMessage(THREAD, "user", "La contraseña del servidor de staging es ZETA-4471", { channel: "webchat" });
  await addMessage(THREAD, "assistant", "Listo, anotado", { channel: "webchat" });
  for (let i = 0; i < 230; i++) {
    await addMessage(THREAD, i % 2 === 0 ? "user" : "assistant", `charla de relleno número ${i}`, { channel: "webchat" });
  }
});

afterEach(() => {
  closeHiveDb();
});

describe("conversation_read", () => {
  test("por texto encuentra un mensaje fuera de los últimos 200, si está indexado", async () => {
    await indexThreadMessages(THREAD, (await getHistory(THREAD, 5)));

    const r = await read({ query: "contraseña servidor staging" });

    expect(r.ok).toBe(true);
    expect(r.messages!.some((m) => m.content.includes("ZETA-4471"))).toBe(true);
  });

  test("por id lee un mensaje antiguo aunque esté fuera de los últimos 200", async () => {
    const first = (await getHistory(THREAD, 1))[0]!;

    const r = await read({ message_ids: [first.id] });

    expect(r.messages!.map((m) => m.content)).toEqual([first.content]);
  });

  test("devuelve como máximo 8 mensajes sin duplicados", async () => {
    await indexThreadMessages(THREAD, await getHistory(THREAD, 300));

    const r = await read({ query: "charla de relleno" });

    expect(r.messages!.length).toBeLessThanOrEqual(8);
    expect(new Set(r.messages!.map((m) => m.id)).size).toBe(r.messages!.length);
  });

  test("sin hilo o sin parámetros responde con error claro", async () => {
    expect((await read({ query: "x" }, {})).ok).toBe(false);
    expect((await read({})).error).toContain("Provide");
  });
});
