process.env.HIVE_DB_PATH = ":memory:";

import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { ArtifactDoc, ModelDoc, ToolDoc } from "../packages/core/src/storage/collections";
import {
  ImageGenerationError, ImageModelNotConfiguredError, generateImage, getImageModelId, setImageModelId,
} from "../packages/core/src/multimodal/image-generation";
import { imageGenerateTool } from "../packages/core/src/tools/image/image-generate";
import { createAllTools } from "../packages/core/src/tools/index";
import { handleGetImageModel, handleSetImageModel } from "../packages/core/src/gateway/routes/multimodal";
import { deleteProviderApiKey } from "../packages/core/src/storage/crypto";
import { TelegramChannel } from "../packages/core/src/channels/telegram";
import { addMessage, getHistory } from "../packages/core/src/agent/conversation-store";
import { handleGetChatHistory } from "../packages/core/src/gateway/routes/chat";
import { readOutboundImageBytes } from "../packages/core/src/channels/base";

const KLEIN = "nvidia/black-forest-labs/flux.2-klein-4b";
const SCHNELL = "nvidia/black-forest-labs/flux.1-schnell";
const cors = (r: Response) => r;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
const okBody = (bytes = JPEG) => JSON.stringify({ artifacts: [{ base64: bytes.toString("base64"), finishReason: "SUCCESS" }] });

/** Ejecuta `fn` y devuelve el error que lanza (falla si no lanza). */
async function rejection(fn: () => Promise<unknown>): Promise<ImageGenerationError> {
  try { await fn(); } catch (e) { return e as ImageGenerationError; }
  throw new Error("se esperaba que fallara");
}

let calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }>;
let respond: (n: number) => Response;
const realFetch = globalThis.fetch;
const prevKey = process.env.NVIDIA_API_KEY;
// El llavero del sistema no depende de HIVE_HOME: sin este doble, el test leería la API key real
// de NVIDIA del usuario. crypto.ts admite reemplazar Bun.secrets justamente para esto.
const realSecrets = (Bun as any).secrets;

beforeEach(async () => {
  (Bun as any).secrets = { get: async () => null, set: async () => {}, delete: async () => false };
  closeHiveDb();
  await ensureHiveDb();
  // La caché de secretos es del proceso y otros archivos de test pueden haberla llenado: se vacía
  // (contra el doble de Bun.secrets, nunca el llavero real).
  await deleteProviderApiKey("nvidia");
  process.env.NVIDIA_API_KEY = "nvapi-test-key";
  calls = [];
  respond = () => new Response(okBody(), { status: 200 });
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    calls.push({ url: String(input), body: JSON.parse(String(init.body ?? "{}")), auth: new Headers(init.headers).get("authorization") });
    return respond(calls.length);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  (Bun as any).secrets = realSecrets;
  globalThis.fetch = realFetch;
  if (prevKey === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = prevKey;
  closeHiveDb();
});

describe("catálogo", () => {
  test("incluye los modelos de imagen verificados y la tool, y no los de edición ni flux.1-dev", async () => {
    const models = (await (await col<ModelDoc>("models")).scan({})).map((e) => e.doc).filter((m) => m.model_type === "image");
    expect(models.map((m) => m.id).sort()).toEqual([SCHNELL, KLEIN]);
    expect(models.every((m) => m.provider_id === "nvidia" && JSON.parse(m.capabilities!).includes("image_generation"))).toBe(true);
    const tool = (await (await col<ToolDoc>("tools")).get("image_generate"))!.doc;
    expect(tool.category).toBe("image");
    expect(createAllTools({} as never).map((t) => t.name)).toContain("image_generate");
  });
});

describe("ajuste del modelo", () => {
  test("solo acepta modelos de imagen de un provider con adaptador y con API key", async () => {
    await expect(setImageModelId("no-existe")).rejects.toThrow(/no existe/);
    const llm = (await (await col<ModelDoc>("models")).scan({})).map((e) => e.doc).find((m) => m.model_type === "llm")!;
    await expect(setImageModelId(llm.id)).rejects.toThrow(/no es un modelo de generación/);

    delete process.env.NVIDIA_API_KEY;
    await expect(setImageModelId(KLEIN)).rejects.toThrow(/API key/);
    process.env.NVIDIA_API_KEY = "nvapi-test-key";

    await setImageModelId(KLEIN);
    expect(await getImageModelId()).toBe(KLEIN);
    await setImageModelId(null);
    expect(await getImageModelId()).toBeNull();
  });

  test("las rutas GET/PUT reflejan el ajuste y devuelven 400 con un modelo inválido", async () => {
    const put = (body: unknown) => handleSetImageModel(new Request("http://x/api/multimodal/image-model", { method: "PUT", body: JSON.stringify(body) }), cors);
    expect((await put({ modelId: KLEIN })).status).toBe(200);
    expect(await (await handleGetImageModel(new Request("http://x/api/multimodal/image-model"), cors)).json()).toEqual({ modelId: KLEIN });
    const bad = await put({ modelId: "nada" });
    expect(bad.status).toBe(400);
    expect((await bad.json() as any).error).toMatch(/no existe/);
    expect((await put({ modelId: 5 })).status).toBe(400);
    expect((await put({ modelId: null })).status).toBe(200);
  });
});

describe("generateImage (NVIDIA)", () => {
  beforeEach(async () => { await setImageModelId(KLEIN); });

  test("sin modelo elegido avisa que falta configurarlo", async () => {
    await setImageModelId(null);
    await expect(generateImage({ prompt: "una abeja" })).rejects.toBeInstanceOf(ImageModelNotConfiguredError);
  });

  test("llama al endpoint del modelo sin prefijo duplicado y con el cuerpo mínimo", async () => {
    const img = await generateImage({ prompt: "  una abeja astronauta  ", aspectRatio: "landscape" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b");
    expect(calls[0]!.auth).toBe("Bearer nvapi-test-key");
    // additionalProperties:false → ni seed ni nada extra
    expect(calls[0]!.body).toEqual({ prompt: "una abeja astronauta", width: 1344, height: 768, steps: 4 });
    expect(img.mimeType).toBe("image/jpeg");
    expect(img.bytes.byteLength).toBe(JPEG.byteLength);
    expect(img.modelId).toBe(KLEIN);
  });

  test("usa el modelo elegido y el formato cuadrado por defecto", async () => {
    await setImageModelId(SCHNELL);
    await generateImage({ prompt: "x" });
    expect(calls[0]!.url).toEndWith("/black-forest-labs/flux.1-schnell");
    expect(calls[0]!.body).toMatchObject({ width: 1024, height: 1024 });
  });

  test("rechaza descripciones vacías o demasiado largas sin llamar a NVIDIA", async () => {
    await expect(generateImage({ prompt: "   " })).rejects.toThrow(/Falta la descripción/);
    await expect(generateImage({ prompt: "a".repeat(10_001) })).rejects.toThrow(/demasiado larga/);
    expect(calls).toHaveLength(0);
  });

  test("detecta PNG por su firma", async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(300)]);
    respond = () => new Response(okBody(png), { status: 200 });
    expect((await generateImage({ prompt: "x" })).mimeType).toBe("image/png");
  });

  test("traduce los errores de NVIDIA a mensajes claros", async () => {
    const fail = async (res: Response) => { respond = () => res.clone(); return rejection(() => generateImage({ prompt: "x" })); };
    expect((await fail(new Response("{}", { status: 401 }))).message).toMatch(/rechazó la API key/);
    expect((await fail(new Response("not found", { status: 404 }))).message).toMatch(/ya no ofrece el modelo black-forest-labs\/flux\.2-klein-4b/);
    expect((await fail(new Response(JSON.stringify({ detail: "Expected: example_id, got: base64" }), { status: 422 }))).message).toMatch(/HTTP 422.*example_id/);
    const filtered = await fail(new Response(JSON.stringify({ artifacts: [{ base64: "", finishReason: "CONTENT_FILTERED" }] }), { status: 200 }));
    expect(filtered.message).toMatch(/filtro de contenido/);
    expect((await fail(new Response("<html>", { status: 200 }))).message).toMatch(/no es JSON/);
    expect((await fail(new Response(JSON.stringify({ artifacts: [] }), { status: 200 }))).message).toMatch(/no devolvió ninguna imagen/);
  });

  test("reintenta una vez ante un 5xx y se recupera", async () => {
    respond = (n) => n === 1 ? new Response("boom", { status: 503 }) : new Response(okBody(), { status: 200 });
    const img = await generateImage({ prompt: "x" });
    expect(calls).toHaveLength(2);
    expect(img.bytes.byteLength).toBe(JPEG.byteLength);
  });

  test("tras dos 429 falla indicando que es reintentable", async () => {
    respond = () => new Response("slow down", { status: 429 });
    const err = await rejection(() => generateImage({ prompt: "x" }));
    expect(err.message).toMatch(/límite de solicitudes/);
    expect(err.retryable).toBe(true);
    expect(calls).toHaveLength(2);
  });
});

describe("tool image_generate", () => {
  const ctx = { configurable: { user_id: "u1", run_id: "r1", task_id: null } };

  test("guarda la imagen como artifact que no caduca y devuelve un artifact_ref que el loop entrega al chat", async () => {
    await setImageModelId(KLEIN);
    const out = await imageGenerateTool.execute({ prompt: "un faro", aspect_ratio: "portrait" }, ctx) as any[];
    expect(Array.isArray(out)).toBe(true);
    const ref = out.find((b) => b.type === "artifact_ref");
    // agent-loop.ts sólo recoge bloques artifact_ref con mime image/*
    expect(ref.mime_type).toStartWith("image/");
    expect(ref.expires_at).toBeNull();
    expect(calls[0]!.body).toMatchObject({ width: 768, height: 1344 });

    const artifact = (await (await col<ArtifactDoc>("artifacts")).get(ref.artifact_id))!.doc;
    expect(artifact).toMatchObject({ kind: "generated_image", user_id: "u1", status: "active", expires_at: null });
    expect(out.find((b) => b.type === "text").text).toContain("No incluyas enlaces");
    // Queda en una carpeta VISIBLE del usuario (no en ~/.hive/artifacts junto a la base de datos)
    expect(artifact.path.startsWith(join(process.env.HIVE_OUTPUT_DIR!, "imagenes"))).toBe(true);
    expect(artifact.path).toMatch(/_un-faro\.jpg$/);
    expect(existsSync(artifact.path)).toBe(true);
    expect(artifact.path).not.toContain("/.hive/");
    expect(out.find((b) => b.type === "text").text).toContain(artifact.path);
  });

  test("sin modelo configurado explica dónde elegirlo", async () => {
    const out = await imageGenerateTool.execute({ prompt: "x" }, ctx) as any;
    expect(out).toMatchObject({ ok: false, needs_configuration: true });
    expect(out.hint).toContain("Providers → Imagen");
  });

  test("un error del proveedor llega como resultado, no como excepción", async () => {
    await setImageModelId(KLEIN);
    respond = () => new Response("{}", { status: 401 });
    const out = await imageGenerateTool.execute({ prompt: "x" }, ctx) as any;
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/API key/);
  });

  test("un aspect_ratio inválido cae al cuadrado", async () => {
    await setImageModelId(KLEIN);
    await imageGenerateTool.execute({ prompt: "x", aspect_ratio: "panoramico" }, ctx);
    expect(calls[0]!.body).toMatchObject({ width: 1024, height: 1024 });
  });
});

describe("entrega por Telegram", () => {
  test("la imagen que crea la tool sale como foto al chat correcto, con el texto de la respuesta", async () => {
    await setImageModelId(KLEIN);
    const out = await imageGenerateTool.execute({ prompt: "un faro" }, { configurable: { user_id: "u1" } }) as any[];
    const ref = out.find((b) => b.type === "artifact_ref");

    // Es el mismo camino que usa server.ts: response.imageArtifacts → message.image {artifactId, mimeType}.
    const image = { artifactId: ref.artifact_id as string, mimeType: ref.mime_type as string };
    const bytes = await readOutboundImageBytes(image);
    expect(bytes?.byteLength).toBe(JPEG.byteLength);

    const sent: Array<{ kind: string; chatId: number; payload: unknown; opts?: any }> = [];
    const channel = new TelegramChannel("acc", { botToken: "123:fake" } as any);
    (channel as any).bot = {
      api: {
        sendPhoto: async (chatId: number, photo: unknown, opts?: any) => { sent.push({ kind: "photo", chatId, payload: photo, opts }); },
        sendMessage: async (chatId: number, text: string) => { sent.push({ kind: "text", chatId, payload: text }); },
      },
    };
    await channel.send("424242", { content: "Listo, aquí tienes tu faro.", image } as any);

    const photo = sent.find((m) => m.kind === "photo")!;
    expect(photo.chatId).toBe(424242);
    expect(photo.payload).toBeTruthy();
    expect(sent.find((m) => m.kind === "text")?.payload).toContain("faro");
  });

  test("si el artifact ya no existe no rompe el envío del texto", async () => {
    const sent: string[] = [];
    const channel = new TelegramChannel("acc", { botToken: "123:fake" } as any);
    (channel as any).bot = { api: { sendPhoto: async () => { sent.push("photo"); }, sendMessage: async (_c: number, t: string) => { sent.push(t); } } };
    await channel.send("424242", { content: "Texto", image: { artifactId: "no-existe", mimeType: "image/jpeg" } } as any);
    expect(sent).toEqual(["Texto"]);
  });
});

describe("historial del chat", () => {
  test("la imagen entregada con una respuesta vuelve al recargar el historial", async () => {
    const thread = "u/webchat/conv-img";
    await addMessage(thread, "user", "hazme una abeja");
    await addMessage(thread, "assistant", "Listo, aquí está", { images: [{ artifactId: "11111111-2222-3333-4444-555555555555", mimeType: "image/jpeg" }] });
    await addMessage(thread, "assistant", "¿Algo más?");
    const res = await handleGetChatHistory(new Request(`http://x/api/chat/history?threadId=${encodeURIComponent(thread)}`), cors);
    const { messages } = await res.json() as { messages: Array<{ content: string; image?: string; imageMimeType?: string }> };
    const withImage = messages.find((m) => m.content === "Listo, aquí está")!;
    expect(withImage.image).toBe("/api/artifacts/11111111-2222-3333-4444-555555555555/download");
    expect(withImage.imageMimeType).toBe("image/jpeg");
    expect(messages.find((m) => m.content === "¿Algo más?")!.image).toBeUndefined();
  });

  test("el modelo ve el id de la imagen en el turno siguiente; el usuario no ve la nota", async () => {
    const thread = "u/webchat/conv-ctx";
    await addMessage(thread, "assistant", "Aquí está", { images: [{ artifactId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", mimeType: "image/jpeg" }] });
    const llm = (await getHistory(thread)).find((m) => m.role === "assistant")!;
    expect(llm.content).toContain("artifact_id=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(llm.content).toContain("no la generes de nuevo");
    const res = await handleGetChatHistory(new Request(`http://x/api/chat/history?threadId=${encodeURIComponent(thread)}`), cors);
    const { messages } = await res.json() as { messages: Array<{ content: string }> };
    expect(messages[0].content).toBe("Aquí está");
  });

  test("con workspace el archivo va al workspace del agente y no pisa uno existente", async () => {
    const { createArtifact } = await import("../packages/core/src/artifacts/store");
    const { mkdtempSync, readdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const ws = mkdtempSync(join(tmpdir(), "hive-ws-"));
    const mk = () => createArtifact({ bytes: JPEG, mimeType: "image/jpeg", kind: "generated_image", userId: "u", expiresAt: null,
      visible: { workspace: ws, folder: "imagenes", label: "¡Una abeja ROBOT!" }, now: Date.UTC(2026, 10, 24, 12, 0) });
    const a = await mk(); const b = await mk();
    expect(a.path.startsWith(join(ws, "imagenes"))).toBe(true);
    expect(a.path).not.toBe(b.path);
    expect(readdirSync(join(ws, "imagenes")).length).toBe(2);
    expect(a.path).toMatch(/una-abeja-robot/);
  });
});
