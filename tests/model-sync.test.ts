/**
 * Actualización de los modelos de la BD preguntándoselos al proveedor (storage/model-sync.ts).
 *
 * Sin red: cada prueba entrega su propio `fetch` y su propia clave. Se comprueba lo que importa para no romper nada:
 * qué se guarda de lo que el proveedor declara, qué se conserva de lo que es del usuario, que un modelo retirado no
 * se borra ni se apaga, y que un fallo no toca la BD ni deja escapar la clave.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { ModelDoc, ProviderDoc } from "../packages/core/src/storage/collections";
import { SEED_DATA } from "../packages/core/src/storage/seed";
import { catalogModelKey } from "../packages/core/src/storage/model-id";
import {
  classifyModelId, syncProviderModels, syncActiveProviderModels, type SyncDeps,
} from "../packages/core/src/storage/model-sync";

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
});
afterEach(() => closeHiveDb());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Un `fetch` que contesta por ruta y recuerda lo que le pidieron. */
function fake(routes: Record<string, (req: { url: string; headers: Headers; body?: string }) => Response>) {
  const calls: Array<{ url: string; headers: Record<string, string>; body?: string }> = [];
  const impl = (async (input: any, init?: any) => {
    const url = String(input);
    const headers = new Headers(init?.headers ?? {});
    calls.push({ url, headers: Object.fromEntries(headers.entries()), body: init?.body });
    for (const [prefix, handler] of Object.entries(routes)) {
      if (url.includes(prefix)) return handler({ url, headers, body: init?.body });
    }
    return json({ error: "ruta no simulada" }, 404);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const deps = (f: ReturnType<typeof fake>, extra: Partial<SyncDeps> = {}): SyncDeps => ({
  fetch: f.impl, loadKey: async () => "clave-secreta-123", loadHeaders: async () => ({}), now: () => 1_700_000_000_000, ...extra,
});

async function setProvider(id: string, patch: Partial<ProviderDoc>) {
  const providers = await col<ProviderDoc>("providers");
  const row = (await providers.get(id))!;
  await providers.put(id, { ...row.doc, ...patch }, { expectedVersion: row.version });
}
async function model(key: string) {
  return (await (await col<ModelDoc>("models")).get(key))?.doc;
}

describe("clasificar un id sin más datos", () => {
  test("separa lo que la app maneja de lo que no", () => {
    expect(classifyModelId("gpt-6.1-sol")).toBe("llm");
    expect(classifyModelId("text-embedding-3-large")).toBe("embedding");
    expect(classifyModelId("whisper-1")).toBe("stt");
    expect(classifyModelId("scribe_v3")).toBe("stt");
    expect(classifyModelId("gpt-live-transcribe")).toBe("realtime");
    expect(classifyModelId("gpt-realtime-2.1")).toBe("realtime");
    expect(classifyModelId("gemini-3.8-live")).toBe("realtime");
    expect(classifyModelId("gemini-3.8-flash-tts")).toBe("tts");
    // Imágenes, vídeo y moderación: la app no los maneja, no se guardan.
    for (const id of ["dall-e-3", "gpt-image-2.6-flare", "imagen-4", "omni-moderation-latest", "llama-guard-4"]) {
      expect(classifyModelId(id)).toBeNull();
    }
    // Auxiliares que listan los proveedores (NVIDIA los lista junto a los modelos de chat) y que no conversan.
    for (const id of ["nvidia/llama-3.1-nemoguard-8b-topic-control", "nvidia/nemotron-3.5-content-safety", "nvidia/nvclip", "nvidia/ai-synthetic-video-detector", "nvidia/nemotron-rerank-1b"]) {
      expect(classifyModelId(id)).toBeNull();
    }
    // Y lo que sí conversa no se pierde por parecerse.
    for (const id of ["nvidia/nemotron-3.5-super-vl-120b-a12b", "google/gemma-4-31b-it", "poolside/laguna-xs-2.1", "stepfun-ai/step-5-preview"]) {
      expect(classifyModelId(id)).toBe("llm");
    }
  });
});

describe("OpenAI-compatible (DeepSeek, NVIDIA, Groq, OpenRouter, Mistral…)", () => {
  test("guarda lo que el proveedor declara y deja los nuevos apagados", async () => {
    const f = fake({
      "/models?output_modalities=transcription": () => json({ data: [{ id: "nvidia/nemotron-3.5-transcribe", name: "Nemotron Transcribe" }] }),
      "/models": () => json({ data: [
        // OpenRouter: ventana, modalidades, parámetros y precio publicados.
        { id: "vendor/nuevo", name: "Nuevo", context_length: 262144, architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
          supported_parameters: ["tools", "reasoning"], pricing: { prompt: "0.000003", completion: "0.000015" } },
        // Mistral: capacidades declaradas.
        { id: "mistral-medio", max_context_length: 128000, capabilities: { completion_chat: true, function_calling: true, vision: false } },
        // Groq: ventana.
        { id: "llama-x", context_window: 131072 },
        // Solo el id.
        { id: "solo-id" },
        // Generación de imágenes: no se guarda.
        { id: "vendor/pintor", architecture: { input_modalities: ["text"], output_modalities: ["image"] } },
      ] }),
    });
    await setProvider("openrouter", { active: true, enabled: true });
    const result = await syncProviderModels("openrouter", deps(f));
    // 5 filas, una es generación de imágenes (no se cuenta ni se guarda): quedan 4. Los 26 modelos que el catálogo
    // sembró para OpenRouter y esta respuesta no lista se marcan como "ya no listados", no se tocan de otro modo.
    expect(result).toMatchObject({ provider: "openrouter", ok: true, found: 5, added: 5, updated: 0, unlisted: 26 });
    expect(await model("openrouter/nvidia/nemotron-3.5-transcribe")).toMatchObject({ model_type: "stt", active: false });

    const nuevo = (await model(catalogModelKey("openrouter", "vendor/nuevo")))!;
    expect(nuevo).toMatchObject({ source: "discovered", enabled: false, active: false, context_window: 262144, name: "Nuevo", model_type: "llm" });
    expect(JSON.parse(nuevo.capabilities!).sort()).toEqual(["chat", "function_calling", "reasoning", "vision"]);
    expect(nuevo.input_per_1m).toBe(3);
    expect(nuevo.output_per_1m).toBe(15);

    const mistral = (await model(catalogModelKey("openrouter", "mistral-medio")))!;
    expect(mistral.context_window).toBe(128000);
    expect(JSON.parse(mistral.capabilities!).sort()).toEqual(["chat", "function_calling"]);
    expect((await model(catalogModelKey("openrouter", "llama-x")))!.context_window).toBe(131072);

    // Lo que no dijo no se inventa: ventana desconocida = 0, precio desconocido = null (que el TS ya sabe tratar).
    const bare = (await model(catalogModelKey("openrouter", "solo-id")))!;
    expect(bare).toMatchObject({ context_window: 0, capabilities: null, input_per_1m: null, output_per_1m: null, enabled: false });
    expect(await model(catalogModelKey("openrouter", "vendor/pintor"))).toBeUndefined();

    // Se manda la clave como Bearer.
    expect(f.calls[0].headers.authorization).toBe("Bearer clave-secreta-123");
  });

  test("lo que ya existe conserva nombre, activación y precio; el proveedor manda en ventana y capacidades", async () => {
    const key = catalogModelKey("deepseek", "deepseek-v4-pro");
    const models = await col<ModelDoc>("models");
    const seeded = (await models.get(key))!;
    await models.put(key, { ...seeded.doc, name: "Mi nombre", enabled: true, active: true, context_window: 1, input_per_1m: 9, output_per_1m: 9, capabilities: JSON.stringify(["chat", "code"]) }, { expectedVersion: seeded.version });
    const f = fake({ "/models": () => json({ data: [{ id: "deepseek-v4-pro", context_window: 1048576, supported_parameters: ["tools"] }] }) });
    await syncProviderModels("deepseek", deps(f));
    const after = (await model(key))!;
    expect(after).toMatchObject({ name: "Mi nombre", enabled: true, active: true, input_per_1m: 9, output_per_1m: 9, context_window: 1048576 });
    // Las capacidades se SUMAN: nunca se quita una que ya había.
    expect(JSON.parse(after.capabilities!).sort()).toEqual(["chat", "code", "function_calling"]);
    expect(after.synced_at).toBe(1_700_000_000_000);
  });

  test("un modelo que el proveedor ya no lista se marca, no se borra ni se apaga; y se desmarca si vuelve", async () => {
    const retired = catalogModelKey("nvidia", "meta/muse-glimmer-30b");
    const models = await col<ModelDoc>("models");
    const row = (await models.get(retired))!;
    await models.put(retired, { ...row.doc, enabled: true, active: true }, { expectedVersion: row.version });
    const without = fake({ "/models": () => json({ data: [{ id: "nvidia/otro-modelo" }] }) });
    const r = await syncProviderModels("nvidia", deps(without));
    expect(r.ok).toBe(true);
    expect(r.unlisted).toBeGreaterThan(0);
    const marked = (await model(retired))!;
    expect(marked).toMatchObject({ unlisted: true, enabled: true, active: true });
    // Vuelve a aparecer: se desmarca.
    const back = fake({ "/models": () => json({ data: [{ id: "meta/muse-glimmer-30b" }] }) });
    await syncProviderModels("nvidia", deps(back));
    expect((await model(retired))!.unlisted).toBeUndefined();
  });

  test("una lista vacía no marca nada como retirado", async () => {
    const f = fake({ "/models": () => json({ data: [] }) });
    const r = await syncProviderModels("nvidia", deps(f));
    expect(r).toMatchObject({ ok: false, found: 0 });
    const rows = (await col<ModelDoc>("models")).findBy("provider_id", "nvidia");
    expect((await rows).every((m) => !m.doc.unlisted)).toBe(true);
  });
});

describe("adaptadores propios", () => {
  test("Anthropic: x-api-key, versión, ventana y capacidades declaradas, paginando", async () => {
    let page = 0;
    const f = fake({ "/v1/models": () => (page++ === 0
      ? json({ data: [{ id: "claude-uno", display_name: "Claude Uno", max_input_tokens: 1000000, capabilities: { image_input: { supported: true }, thinking: { supported: true } } }], has_more: true, last_id: "claude-uno" })
      : json({ data: [{ id: "claude-dos", max_input_tokens: 200000 }], has_more: false })) });
    await setProvider("anthropic", { active: true, enabled: true });
    const r = await syncProviderModels("anthropic", deps(f));
    expect(r).toMatchObject({ ok: true, found: 2 });
    expect(f.calls[0].headers["x-api-key"]).toBe("clave-secreta-123");
    expect(f.calls[0].headers["anthropic-version"]).toBe("2023-06-01");
    expect(f.calls[1].url).toContain("after_id=claude-uno");
    const uno = (await model("claude-uno"))!;
    expect(uno).toMatchObject({ name: "Claude Uno", context_window: 1000000 });
    expect(JSON.parse(uno.capabilities!).sort()).toEqual(["chat", "reasoning", "vision"]);
  });

  test("Gemini: el tipo sale de los métodos de generación y se omiten imágenes y vídeo", async () => {
    const f = fake({ "/models": () => json({ models: [
      { name: "models/gemini-9-flash", displayName: "Gemini 9 Flash", inputTokenLimit: 1048576, supportedGenerationMethods: ["generateContent", "streamGenerateContent"] },
      { name: "models/gemini-9-live", inputTokenLimit: 131072, supportedGenerationMethods: ["bidiGenerateContent"] },
      { name: "models/gemini-9-flash-tts", supportedGenerationMethods: ["generateContent"] },
      { name: "models/text-embedding-9", supportedGenerationMethods: ["embedContent"] },
      { name: "models/imagen-9", supportedGenerationMethods: ["predict"] },
    ] }) });
    await setProvider("gemini", { active: true, enabled: true });
    const r = await syncProviderModels("gemini", deps(f));
    expect(r).toMatchObject({ ok: true, found: 4 });
    expect(f.calls[0].headers["x-goog-api-key"]).toBe("clave-secreta-123");
    expect(f.calls[0].url).not.toContain("clave-secreta-123"); // la clave va en cabecera, nunca en la URL
    expect((await model("gemini-9-flash"))).toMatchObject({ model_type: "llm", context_window: 1048576 });
    expect((await model("gemini-9-live"))).toMatchObject({ model_type: "realtime" });
    expect((await model("gemini-9-flash-tts"))).toMatchObject({ model_type: "tts" });
    expect((await model("text-embedding-9"))).toMatchObject({ model_type: "embedding" });
    expect(await model("imagen-9")).toBeUndefined();
  });

  test("Ollama: ventana de contexto y capacidades vienen de /api/show, y son gratis y entran encendidos", async () => {
    const f = fake({
      "/api/tags": () => json({ models: [{ name: "llama3.3:8b" }, { name: "visor:7b" }] }),
      "/api/show": ({ body }) => (JSON.parse(body!).model === "visor:7b"
        ? json({ model_info: { "llama.context_length": 32768 }, capabilities: ["completion", "vision", "tools"] })
        : json({ model_info: { "llama.context_length": 131072 }, capabilities: ["completion"] })),
    });
    const r = await syncProviderModels("ollama", deps(f, { loadKey: async () => "" }));
    expect(r).toMatchObject({ ok: true, found: 2, added: 2 });
    const visor = (await model(catalogModelKey("ollama", "visor:7b")))!;
    expect(visor).toMatchObject({ context_window: 32768, enabled: true, active: false, input_per_1m: 0, output_per_1m: 0 });
    expect(JSON.parse(visor.capabilities!).sort()).toEqual(["chat", "function_calling", "vision"]);
    expect((await model(catalogModelKey("ollama", "llama3.3:8b")))!.context_window).toBe(131072);
  });

  test("ElevenLabs: solo los modelos de síntesis de voz", async () => {
    const f = fake({ "/models": () => json([
      { model_id: "eleven_v9", name: "Eleven V9", can_do_text_to_speech: true },
      { model_id: "eleven_sts", name: "Solo conversión", can_do_text_to_speech: false },
    ]) });
    const r = await syncProviderModels("elevenlabs", deps(f));
    expect(r).toMatchObject({ ok: true, found: 1 });
    expect(f.calls[0].headers["xi-api-key"]).toBe("clave-secreta-123");
    expect((await model("eleven_v9"))).toMatchObject({ model_type: "tts", name: "Eleven V9" });
  });
});

describe("fallos y alcance", () => {
  test("un 401 no toca la BD y el error no contiene la clave", async () => {
    const f = fake({ "/models": () => json({ error: "clave-secreta-123 inválida" }, 401) });
    const before = (await (await col<ModelDoc>("models")).scan({})).length;
    const r = await syncProviderModels("openai", deps(f));
    expect(r).toMatchObject({ ok: false, status: 401, error: "el proveedor respondió 401" });
    expect(JSON.stringify(r)).not.toContain("clave-secreta-123");
    expect((await (await col<ModelDoc>("models")).scan({})).length).toBe(before);
  });

  test("sin clave guardada no se llama a nadie (salvo los de listado público)", async () => {
    const f = fake({ "/models": () => json({ data: [{ id: "x" }] }) });
    const r = await syncProviderModels("openai", deps(f, { loadKey: async () => "" }));
    expect(r).toMatchObject({ ok: false, skipped: "sin clave guardada" });
    expect(f.calls.length).toBe(0);
    await syncProviderModels("modelscope", deps(f, { loadKey: async () => "" }));
    expect(f.calls.length).toBe(1);
  });

  test("un cuerpo inesperado o una caída de red se informan sin romper", async () => {
    const throwing = (async () => { throw Object.assign(new Error("boom con clave-secreta-123"), { name: "TypeError" }); }) as unknown as typeof fetch;
    const r = await syncProviderModels("openai", { ...deps(fake({})), fetch: throwing });
    expect(r).toMatchObject({ ok: false, error: "no se pudo consultar el proveedor" });
    expect(JSON.stringify(r)).not.toContain("clave-secreta-123");
    const odd = fake({ "/models": () => new Response("<html>no soy json</html>", { status: 200 }) });
    expect((await syncProviderModels("openai", deps(odd))).ok).toBe(false);
  });

  test("solo se consultan los providers ACTIVOS", async () => {
    const providers = await col<ProviderDoc>("providers");
    for (const row of await providers.scan({})) {
      await providers.put(row.id, { ...row.doc, active: row.id === "deepseek" || row.id === "groq", enabled: row.id === "deepseek" || row.id === "groq" }, { expectedVersion: row.version });
    }
    const f = fake({ "/models": () => json({ data: [{ id: "algo" }] }) });
    const results = await syncActiveProviderModels(deps(f));
    expect(results.map((r) => r.provider)).toEqual(["deepseek", "groq"]);
    expect(f.calls.length).toBe(2);
    expect(f.calls.map((c) => new URL(c.url).host).sort()).toEqual(["api.deepseek.com", "api.groq.com"]);
  });

  test("lo sembrado sigue ahí: la actualización no borra el catálogo", async () => {
    const f = fake({ "/models": () => json({ data: [{ id: "solo-este" }] }) });
    await setProvider("deepseek", { active: true, enabled: true });
    await syncProviderModels("deepseek", deps(f));
    const seeded = SEED_DATA.models.filter((m) => m.providerId === "deepseek");
    for (const s of seeded) expect(await model(catalogModelKey("deepseek", s.id))).toBeTruthy();
  });
});
