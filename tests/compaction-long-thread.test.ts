/**
 * compactThread en hilos largos: la compactación debe seguir avanzando pasados
 * los primeros 200 mensajes. getHistory() devuelve los 200 MÁS ANTIGUOS, así que
 * antes la segunda compactación veía el mismo corte que la primera y se detenía.
 * El LLM se sustituye por uno falso; HIVE_DB_PATH=":memory:" para no dejar estado.
 */

process.env.HIVE_DB_PATH = ":memory:";
process.env.HIVE_LLM_STREAM = "0";
process.env.OPENAI_API_KEY = "llave-de-prueba";
// Llave maestra por entorno: el almacén de secretos no toca el llavero del SO ni ~/.hive.
process.env.HIVE_MASTER_KEY = "x".repeat(32);

import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";

// El modelo se simula a nivel de `fetch` (como el resto de pruebas del repo): `mock.module` no se deshace
// al terminar el archivo y contaminaría las pruebas que corren después en el mismo proceso.
const realFetch = globalThis.fetch;
const prompts: string[] = [];
globalThis.fetch = (async (_input: any, init: any = {}) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as { messages: Array<{ content: unknown }> };
  prompts.push(String(body.messages[body.messages.length - 1]!.content));
  return Response.json({
    id: "c", object: "chat.completion", created: 1, model: "m",
    choices: [{
      index: 0, finish_reason: "stop",
      message: {
        role: "assistant",
        content: JSON.stringify({
          objective: "conversación larga",
          facts: [`compactación número ${prompts.length}`],
          changes: [], verification: [], dead_ends: [], plan: [],
        }),
      },
    }],
    usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 },
  });
}) as unknown as typeof fetch;

const { closeHiveDb } = await import("../packages/core/src/storage/hivedb");
const { ensureHiveDb } = await import("../packages/core/src/storage/bootstrap");
const { addMessage, getSummary, getMessageCount } = await import("../packages/core/src/agent/conversation-store");
const { compactThread, maybeCompact } = await import("../packages/core/src/agent/compaction");
const { col, toIndexable } = await import("../packages/core/src/storage/hive");

const THREAD = "u/web/larga";

async function agregar(desde: number, hasta: number) {
  for (let i = desde; i < hasta; i++) {
    await addMessage(THREAD, i % 2 === 0 ? "user" : "assistant", `mensaje ${i}`, { channel: "webchat" });
  }
}

beforeEach(async () => {
  prompts.length = 0;
  closeHiveDb();
  await ensureHiveDb();
  // hive resume el modelo del coordinador (getDefaultLLM): se le da uno que apunta al fetch simulado.
  await (await col<any>("providers")).put("openai", {
    id: "openai", name: "OpenAI", base_url: "https://proveedor.invalido/v1", category: "llm",
    num_ctx: null, num_gpu: 0, enabled: true, active: true, created_at: Date.now(),
  });
  await (await col<any>("models")).put("modelo-compacta", {
    id: "modelo-compacta", provider_id: "openai", name: "modelo-compacta", model_type: "llm",
    context_window: 128_000, capabilities: null, enabled: true, active: true,
  });
  const agents = await col<any>("agents");
  for (const e of await agents.findBy("role", "coordinator")) {
    await agents.put(e.id, { ...e.doc, provider_id: toIndexable("openai"), model_id: toIndexable("modelo-compacta") });
  }
});

afterEach(() => {
  closeHiveDb();
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("compactThread en hilos largos", () => {
  test("sigue avanzando pasados los primeros 200 mensajes", async () => {
    await agregar(0, 250);
    await compactThread(THREAD);
    const primera = await getSummary(THREAD);
    expect(primera).not.toBeNull();

    await agregar(250, 450);
    await compactThread(THREAD);
    const segunda = await getSummary(THREAD);

    expect(segunda!.last_message_id).toBeGreaterThan(primera!.last_message_id);
    expect(segunda!.last_message_id).toBeGreaterThan(400);
    expect(prompts.length).toBe(2);
  });

  test("la segunda compactación incorpora el traspaso de la primera y solo lo nuevo", async () => {
    await agregar(0, 250);
    await compactThread(THREAD);
    await agregar(250, 450);
    await compactThread(THREAD);

    expect(prompts[1]).toContain("compactación número 1");
    expect(prompts[1]).not.toContain("mensaje 3\n");
  });

  test("messages_covered es acumulado", async () => {
    await agregar(0, 250);
    await compactThread(THREAD);
    const primera = await getSummary(THREAD);
    await agregar(250, 450);
    await compactThread(THREAD);
    const segunda = await getSummary(THREAD);

    expect(segunda!.messages_covered).toBe(primera!.messages_covered + (segunda!.last_message_id - primera!.last_message_id));
  });

  test("maybeCompact no recompacta cada turno si el historial vivo es corto", async () => {
    await agregar(0, 250);
    // Ventana de 800 tokens (umbral 200 al 25 %): el hilo entero lo supera.
    await maybeCompact(THREAD, undefined, 800);
    const n = prompts.length;
    expect(n).toBe(1);

    // Pocos mensajes nuevos: lo que sigue vivo (resumen + cola) está por debajo del umbral.
    await agregar(250, 256);
    await maybeCompact(THREAD, undefined, 800);
    expect(prompts.length).toBe(n);
    expect(await getMessageCount(THREAD)).toBe(256);
  });
});
