/**
 * resolveContext — enrutamiento de un mensaje entrante a su conversación.
 *
 * Es el punto donde antes vivía `const threadId = userId`: un solo hilo para
 * Telegram, WhatsApp, la web y la voz. Estos tests fijan lo contrario — que cada
 * canal y cada contacto caen en hilos distintos, y que la web puede tener varias.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { resolveContext } from "../packages/core/src/gateway/resolver";
import { createWebConversation, listThreads, ensureLegacyThread } from "../packages/core/src/agent/thread-store";
import { addMessage } from "../packages/core/src/agent/conversation-store";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { col } from "../packages/core/src/storage/hive";
import type { UserDoc, AgentDoc } from "../packages/core/src/storage/collections";

const USER_ID = "owner-1";

beforeAll(async () => {
  // Mínimo viable: resolveContext exige un usuario del onboarding y busca el
  // coordinador por índice.
  const users = await col<UserDoc>("users");
  await users.put(USER_ID, { id: USER_ID, created_at: Date.now() } as UserDoc);

  const agents = await col<AgentDoc>("agents");
  await agents.createIndex("role", {});
  await agents.put("bee", { id: "bee", role: "coordinator" } as AgentDoc);

  const threads = await col("conversationThreads");
  await threads.createIndex("user_id", {});
});

afterAll(() => {
  closeHiveDb();
});

describe("un hilo por canal y por contacto", () => {
  test("Telegram y la web no comparten conversación", async () => {
    const web = await resolveContext({ channel: "webchat", channelUserId: USER_ID });
    const telegram = await resolveContext({
      channel: "telegram",
      channelUserId: "558812345",
      peerId: "558812345",
    });

    expect(telegram.userId).toBe(web.userId);
    expect(telegram.threadId).not.toBe(web.threadId);
    expect(telegram.threadId).toBe(`${USER_ID}/telegram/558812345`);
  });

  test("dos contactos del mismo canal tampoco", async () => {
    const uno = await resolveContext({ channel: "telegram", channelUserId: "111", peerId: "111" });
    const grupo = await resolveContext({
      channel: "telegram",
      channelUserId: "111:222",
      peerId: "111:222",
      peerKind: "group",
    });

    expect(uno.threadId).not.toBe(grupo.threadId);
  });

  test("el mismo contacto siempre vuelve a su hilo", async () => {
    const primera = await resolveContext({ channel: "whatsapp", channelUserId: "573001", peerId: "573001" });
    const segunda = await resolveContext({ channel: "whatsapp", channelUserId: "573001", peerId: "573001" });
    expect(primera.threadId).toBe(segunda.threadId);
  });

  test("cada canal queda registrado como conversación propia", async () => {
    const todas = await listThreads(USER_ID);
    const canales = new Set(todas.map((t) => t.channel));
    expect(canales.has("telegram")).toBe(true);
    expect(canales.has("whatsapp")).toBe(true);
    expect(canales.has("webchat")).toBe(true);
  });
});

describe("varias conversaciones en la web", () => {
  test("la web sin conversación indicada sigue en la más reciente", async () => {
    const primera = await resolveContext({ channel: "webchat", channelUserId: USER_ID });
    const otra = await createWebConversation(USER_ID);
    await addMessage(otra.id, "user", "esta es la nueva");

    const despues = await resolveContext({ channel: "webchat", channelUserId: USER_ID });
    expect(despues.threadId).toBe(otra.id);
    expect(despues.threadId).not.toBe(primera.threadId);
  });

  test("con conversación indicada, escribe en esa", async () => {
    const elegida = await createWebConversation(USER_ID);
    const ctx = await resolveContext({
      channel: "webchat",
      channelUserId: USER_ID,
      peerId: elegida.peer_id,
    });
    expect(ctx.threadId).toBe(elegida.id);
  });
});

describe("historial anterior a la separación", () => {
  test("el hilo viejo sigue siendo legible y no contamina los nuevos", async () => {
    const legacyUser = "owner-legacy";
    const users = await col<UserDoc>("users");
    await users.put(legacyUser, { id: legacyUser, created_at: Date.now() } as UserDoc);

    await addMessage(legacyUser, "user", "lo que hablamos antes");
    await ensureLegacyThread(legacyUser);

    const registradas = await listThreads(legacyUser);
    expect(registradas.map((t) => t.id)).toContain(legacyUser);

    // Y una conversación nueva del mismo usuario arranca vacía.
    const nueva = await createWebConversation(legacyUser);
    expect(nueva.message_count).toBe(0);
  });
});

describe("API REST de conversaciones", () => {
  const cors = (res: Response) => res;

  test("crear, listar, renombrar y borrar", async () => {
    const { handleListConversations, handleCreateConversation, handleRenameConversation, handleDeleteConversation } =
      await import("../packages/core/src/gateway/routes/conversations");

    const creada = await handleCreateConversation(
      new Request("http://x/api/conversations", { method: "POST", body: "{}" }),
      cors as any
    );
    expect(creada.status).toBe(201);
    const { conversation } = await creada.json();
    expect(conversation.id.startsWith(`${USER_ID}/webchat/conv-`)).toBe(true);

    const listadas = await handleListConversations(
      new Request("http://x/api/conversations?channel=webchat"),
      cors as any
    );
    const { conversations } = await listadas.json();
    expect(conversations.some((c: any) => c.id === conversation.id)).toBe(true);
    // Sólo las de la web: los hilos de Telegram y WhatsApp no salen en esta lista.
    expect(conversations.every((c: any) => c.channel === "webchat")).toBe(true);

    const renombrada = await handleRenameConversation(
      new Request("http://x/api/conversations", {
        method: "PATCH",
        body: JSON.stringify({ threadId: conversation.id, title: "Cierre de mes" }),
      }),
      cors as any
    );
    expect((await renombrada.json()).conversation.title).toBe("Cierre de mes");

    const borrada = await handleDeleteConversation(
      new Request(`http://x/api/conversations?threadId=${encodeURIComponent(conversation.id)}`, { method: "DELETE" }),
      cors as any
    );
    expect(borrada.status).toBe(200);

    const despues = await handleListConversations(new Request("http://x/api/conversations"), cors as any);
    expect((await despues.json()).conversations.some((c: any) => c.id === conversation.id)).toBe(false);
  });

  test("un hilo ajeno o inexistente se rechaza", async () => {
    const { handleDeleteConversation } = await import("../packages/core/src/gateway/routes/conversations");
    const res = await handleDeleteConversation(
      new Request("http://x/api/conversations?threadId=otro-usuario%2Fwebchat%2Fconv-x", { method: "DELETE" }),
      cors as any
    );
    expect(res.status).toBe(404);
  });
});
