/**
 * thread-store — el registro de conversaciones y, sobre todo, el aislamiento
 * entre hilos.
 *
 * El aislamiento es lo que no puede fallar: hasta la separación por canal todos
 * los canales compartían un solo hilo (`thread_id = userId`), así que lo hablado
 * por Telegram entraba en el contexto de la web. Estos tests comprueban que dos
 * conversaciones no se leen entre sí, incluido el caso peliagudo del hilo legacy
 * frente a los nuevos.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, afterAll } from "bun:test";
import { addMessage, getRecentMessages, getSummary, saveSummary, saveScratchpadNote, getScratchpad } from "../packages/core/src/agent/conversation-store";
import {
  ensureThread,
  listThreads,
  renameThread,
  deleteThread,
  getThread,
  createWebConversation,
  mostRecentWebThread,
  ensureLegacyThread,
  deriveTitle,
} from "../packages/core/src/agent/thread-store";
import { makeThreadId } from "../packages/core/src/agent/thread-id";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { col } from "../packages/core/src/storage/hive";

afterAll(() => {
  closeHiveDb();
});

/** `listThreads` usa findBy sobre user_id — en :memory: hay que crear el índice. */
async function ensureIndex(): Promise<void> {
  const c = await col("conversationThreads");
  await c.createIndex("user_id", {});
}

/**
 * El registro se actualiza fuera del camino del mensaje (addMessage lanza
 * touchThread sin esperarlo, para que un fallo del catálogo no tumbe un turno),
 * así que el título y el contador llegan un tick después.
 */
async function waitFor(check: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor: se agotó el tiempo esperando al registro de conversaciones");
}

describe("aislamiento entre conversaciones", () => {
  test("cada canal lee sólo sus propios mensajes", async () => {
    const web = makeThreadId("u-iso", "webchat", "conv-1");
    const telegram = makeThreadId("u-iso", "telegram", "12345");

    await addMessage(web, "user", "esto lo escribí en la web");
    await addMessage(telegram, "user", "esto lo mandé por Telegram", { channel: "telegram" });

    const enWeb = await getRecentMessages(web, 10);
    const enTelegram = await getRecentMessages(telegram, 10);

    expect(enWeb).toHaveLength(1);
    expect(enWeb[0].content).toBe("esto lo escribí en la web");
    expect(enTelegram).toHaveLength(1);
    expect(enTelegram[0].content).toBe("esto lo mandé por Telegram");
  });

  test("dos conversaciones de la web no se mezclan", async () => {
    const a = makeThreadId("u-web", "webchat", "conv-a");
    const b = makeThreadId("u-web", "webchat", "conv-b");

    await addMessage(a, "user", "hablemos de facturas");
    await addMessage(b, "user", "hablemos de vacaciones");

    expect((await getRecentMessages(a, 10)).map((m) => m.content)).toEqual(["hablemos de facturas"]);
    expect((await getRecentMessages(b, 10)).map((m) => m.content)).toEqual(["hablemos de vacaciones"]);
  });

  test("el hilo legacy no se traga los hilos nuevos del mismo usuario", async () => {
    // El motivo de que el separador sea "/": `conversations` se lee por prefijo,
    // y el hilo previo a la separación escanea "u-legacy:".
    const legacy = "u-legacy";
    const nuevo = makeThreadId("u-legacy", "webchat", "conv-nueva");

    await addMessage(legacy, "user", "conversación de antes");
    await addMessage(nuevo, "user", "conversación de ahora");

    const enLegacy = await getRecentMessages(legacy, 10);
    expect(enLegacy).toHaveLength(1);
    expect(enLegacy[0].content).toBe("conversación de antes");
  });

  test("un peerId compuesto no invade el chat privado", async () => {
    const dm = makeThreadId("u-tg", "telegram", "999");
    const grupo = makeThreadId("u-tg", "telegram", "999:777");

    await addMessage(dm, "user", "mensaje privado", { channel: "telegram" });
    await addMessage(grupo, "user", "mensaje del grupo", { channel: "telegram" });

    expect((await getRecentMessages(dm, 10)).map((m) => m.content)).toEqual(["mensaje privado"]);
  });

  test("resumen y notas también van por hilo", async () => {
    const a = makeThreadId("u-sum", "webchat", "conv-a");
    const b = makeThreadId("u-sum", "webchat", "conv-b");

    await saveSummary(a, "resumen de A", 5, 5);
    await saveScratchpadNote(a, "nota", "sólo de A");

    expect((await getSummary(a))?.summary).toBe("resumen de A");
    expect(await getSummary(b)).toBeNull();
    expect(await getScratchpad(b)).toEqual([]);
  });
});

describe("registro de conversaciones", () => {
  test("ensureThread es idempotente", async () => {
    const first = await ensureThread({ userId: "u-reg", channel: "webchat", peerId: "conv-x" });
    const second = await ensureThread({ userId: "u-reg", channel: "webchat", peerId: "conv-x" });
    expect(first).toBe(second);
    expect(await getThread(first)).not.toBeNull();
  });

  test("el título sale del primer mensaje del usuario", async () => {
    await ensureIndex();
    const threadId = await ensureThread({ userId: "u-title", channel: "webchat", peerId: "conv-t" });

    await addMessage(threadId, "user", "[Timestamp: lunes] ¿Cuánto facturamos en julio?");
    await addMessage(threadId, "assistant", "Facturaron 12 millones.");

    await waitFor(async () => (await getThread(threadId))?.message_count === 2);
    const thread = await getThread(threadId);
    expect(thread?.title).toBe("¿Cuánto facturamos en julio?");
    expect(thread?.message_count).toBe(2);
  });

  test("deriveTitle recorta y descarta el timestamp", () => {
    expect(deriveTitle("[Timestamp: martes] hola")).toBe("hola");
    expect(deriveTitle("x".repeat(80))?.length).toBe(60);
    expect(deriveTitle("   ")).toBeNull();
  });

  test("listThreads ordena por actividad y filtra por canal", async () => {
    await ensureIndex();
    const vieja = await ensureThread({ userId: "u-list", channel: "webchat", peerId: "conv-vieja" });
    await addMessage(vieja, "user", "primera");
    await waitFor(async () => !!(await getThread(vieja))?.title);
    const nueva = await ensureThread({ userId: "u-list", channel: "webchat", peerId: "conv-nueva" });
    await addMessage(nueva, "user", "segunda");
    await waitFor(async () => !!(await getThread(nueva))?.title);
    await ensureThread({ userId: "u-list", channel: "telegram", peerId: "555" });

    const web = await listThreads("u-list", { channel: "webchat" });
    expect(web.map((t) => t.id)).toEqual([nueva, vieja]);
    expect((await mostRecentWebThread("u-list"))?.id).toBe(nueva);
    expect(await listThreads("u-list")).toHaveLength(3);
  });

  test("renombrar y borrar", async () => {
    await ensureIndex();
    const conversation = await createWebConversation("u-del");
    await addMessage(conversation.id, "user", "algo que borrar");
    await saveSummary(conversation.id, "resumen", 1, 1);
    await saveScratchpadNote(conversation.id, "nota", "valor");

    await renameThread(conversation.id, "Presupuesto 2027");
    expect((await getThread(conversation.id))?.title).toBe("Presupuesto 2027");

    await deleteThread(conversation.id);
    expect(await getThread(conversation.id)).toBeNull();
    expect(await getRecentMessages(conversation.id, 10)).toEqual([]);
    expect(await getSummary(conversation.id)).toBeNull();
    expect(await getScratchpad(conversation.id)).toEqual([]);
  });
});

describe("hilo legacy", () => {
  test("se registra como conversación cuando hay historial", async () => {
    await ensureIndex();
    await addMessage("u-old", "user", "lo de siempre");

    expect(await ensureLegacyThread("u-old")).toBe(true);
    const thread = await getThread("u-old");
    expect(thread?.channel).toBe("webchat");
    expect(thread?.title).toBe("Conversación anterior");

    // Idempotente: una segunda pasada no lo duplica ni lo reescribe.
    expect(await ensureLegacyThread("u-old")).toBe(false);
  });

  test("no inventa una conversación para un usuario sin historial", async () => {
    expect(await ensureLegacyThread("u-nuevo")).toBe(false);
    expect(await getThread("u-nuevo")).toBeNull();
  });
});
