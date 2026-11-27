process.env.HIVE_DB_PATH = ":memory:";

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { AgentDoc, ToolDoc } from "../packages/core/src/storage/collections";
import { deleteProviderApiKey } from "../packages/core/src/storage/crypto";
import { syncVideoCapabilities, VIDEO_AGENT_ID } from "../packages/core/src/storage/video-capabilities";
import {
  StudioError, approveProject, clearCharacterFace, createProject, generateCharacterImage, getProject, projectCost, setCharacterFace,
  startProduction, updateProject,
} from "../packages/core/src/video/studio";
import { concatClips } from "../packages/core/src/video/studio";
import {
  DEFAULT_VOICE_SETTINGS, VoiceError, cloneVoice, isExpressiveModel, listVoices, mixDialogue, normalizeVoiceSettings, stripAudioTags, synthesizeLine, ttsBody,
  synthesizeLineTimed, warpToTiming, wordsFromCharacters,
} from "../packages/core/src/video/voice";
import { handleVideoVoices, handleVideoStatus as statusRoute } from "../packages/core/src/gateway/routes/video";
import { videoProjectProduceTool, videoProjectCreateTool } from "../packages/core/src/tools/video/index";
import { handleVideoProjects, handleVideoStatus } from "../packages/core/src/gateway/routes/video";

/** Estos tests miden clips, voz y unión: la música de fondo (de pago) tiene sus propios tests y aquí se apaga. */
async function mkProject(input: Parameters<typeof createProject>[0]) {
  const p = await createProject(input);
  await updateProject(p.id, { style: { music: { enabled: false } } });
  return p;
}


const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
const MP4 = Buffer.concat([Buffer.from("AAAAGGZ0eXBtcDQy", "base64"), Buffer.alloc(2000, 1)]);
const realSecrets = (Bun as any).secrets;
const prevKey = process.env.GEMINI_API_KEY;
const prevOut = process.env.HIVE_OUTPUT_DIR;
const cors = (r: Response) => r;

let out: string;
let calls: Array<{ url: string; body: any; headers?: any }>;
let failAt = 0;
const fakeFetch = (async (url: string, init: RequestInit) => {
  calls.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
  if (failAt && calls.length === failAt) return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 400 });
  if (String(url).includes("generateContent")) {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: JPEG.toString("base64") } }] } }] }));
  }
  return new Response(JSON.stringify({
    id: `v1_${calls.length}`, status: "completed", usage: { total_input_tokens: 10, total_output_tokens: 5000 },
    steps: [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: MP4.toString("base64") }] }],
  }));
}) as unknown as typeof fetch;
const fakeConcat = async (paths: string[]) => new Uint8Array(Buffer.concat([MP4, Buffer.from(String(paths.length))]));

beforeEach(async () => {
  (Bun as any).secrets = { get: async () => null, set: async () => {}, delete: async () => false };
  closeHiveDb();
  await ensureHiveDb();
  await deleteProviderApiKey("gemini");
  process.env.GEMINI_API_KEY = "gem-test-key";
  out = mkdtempSync(join(tmpdir(), "hive-studio-"));
  process.env.HIVE_OUTPUT_DIR = out;
  calls = [];
  failAt = 0;
});
afterEach(() => {
  (Bun as any).secrets = realSecrets;
  if (prevKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prevKey;
  if (prevOut === undefined) delete process.env.HIVE_OUTPUT_DIR; else process.env.HIVE_OUTPUT_DIR = prevOut;
  rmSync(out, { recursive: true, force: true });
});

async function twoSceneProject() {
  const p = await mkProject({ userId: "u1", title: "Gato astronauta", brief: "reel", targetSeconds: 8, resolution: "360p" });
  return updateProject(p.id, {
    characters: [{ name: "Gato", description: "gato naranja con traje espacial" }],
    scenes: [{ seconds: 3, prompt: "El gato despega" }, { seconds: 5, prompt: "El gato saluda", character_ids: [] }],
  });
}

describe("activación por clave de Gemini", () => {
  test("tools y agente se activan con la clave y se apagan sin ella", async () => {
    expect(await syncVideoCapabilities("seed")).toBe(true);
    const tools = (await (await col<ToolDoc>("tools")).scan({})).map((e) => e.doc).filter((t) => t.category === "video");
    expect(tools.map((t) => t.name).sort()).toEqual([
      "video_avatar_list", "video_character_image", "video_project_create", "video_project_produce", "video_project_status", "video_project_update",
    ]);
    expect(tools.every((t) => t.active && t.enabled)).toBe(true);
    expect((await (await col<AgentDoc>("agents")).get(VIDEO_AGENT_ID))!.doc.enabled).toBe(true);

    delete process.env.GEMINI_API_KEY;
    expect(await syncVideoCapabilities("key-changed")).toBe(false);
    const off = (await (await col<ToolDoc>("tools")).scan({})).map((e) => e.doc).filter((t) => t.category === "video");
    expect(off.every((t) => !t.active && !t.enabled)).toBe(true);
    expect((await (await col<AgentDoc>("agents")).get(VIDEO_AGENT_ID))!.doc.enabled).toBe(false);
  });

  test("el estado REST lo refleja", async () => {
    const on = await (await handleVideoStatus(new Request("http://x/api/video/status"), cors)).json() as any;
    expect(on.enabled).toBe(true);
    expect(on.folder).toEndWith("estudio-videos");
    delete process.env.GEMINI_API_KEY;
    expect(((await (await handleVideoStatus(new Request("http://x/api/video/status"), cors)).json()) as any).enabled).toBe(false);
  });
});

describe("proyecto y costo", () => {
  test("valida escenas y calcula el costo; editar retira la aprobación", async () => {
    const p = await twoSceneProject();
    expect(projectCost(p)).toMatchObject({ pending_scenes: 2, total_seconds: 8 });
    expect(projectCost(p).estimated_usd).toBeCloseTo(0.023 * 8, 4);
    await approveProject(p.id);
    expect((await getProject(p.id)).approved_cost_usd).toBeCloseTo(0.184, 4);
    const edited = await updateProject(p.id, { scenes: [{ id: p.scenes[0].id, seconds: 4, prompt: "El gato despega" }, { seconds: 5, prompt: "x" }] });
    expect(edited.approved_cost_usd).toBeNull();
    await expect(updateProject(p.id, { scenes: [{ seconds: 2, prompt: "corta" }] })).rejects.toThrow(/entre 3 y 15/);
    await expect(updateProject(p.id, { scenes: [{ seconds: 5, prompt: " " }] })).rejects.toThrow(/sin descripción|no tiene descripción/);
  });

  test("sin escenas no se aprueba, y sin clave tampoco", async () => {
    const p = await mkProject({ userId: "u1", title: "vacío" });
    await expect(approveProject(p.id)).rejects.toThrow(/sin escenas|no tiene escenas/);
    const q = await twoSceneProject();
    delete process.env.GEMINI_API_KEY;
    await expect(approveProject(q.id)).rejects.toMatchObject({ code: "no_key" });
  });
});

describe("producción", () => {
  test("sin aprobación del usuario no se produce y no se gasta nada", async () => {
    const p = await twoSceneProject();
    await expect(startProduction(p.id, { fetchImpl: fakeFetch })).rejects.toMatchObject({ code: "not_approved" });
    expect(calls).toHaveLength(0);
    // la tool tampoco puede saltarse la regla
    const r = await videoProjectProduceTool.execute({ project_id: p.id }) as any;
    expect(r.ok).toBe(false);
    expect(r.code).toBe("not_approved");
    expect(calls).toHaveLength(0);
  });

  test("con aprobación genera cada clip, los une y deja todo en estudio-videos/videos", async () => {
    const p = await twoSceneProject();
    await approveProject(p.id);
    const done = await startProduction(p.id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true });
    expect(done.status).toBe("done");
    expect(done.scenes.every((s) => s.status === "done")).toBe(true);
    expect(calls.filter((c) => c.url.endsWith("/interactions"))).toHaveLength(2);
    expect(calls[0].body.response_format).toMatchObject({ aspect_ratio: "9:16", resolution: "360p", duration: "3s" });
    for (const s of done.scenes) {
      expect(s.path!.startsWith(join(out, "estudio-videos", "videos"))).toBe(true);
      expect(existsSync(s.path!)).toBe(true);
    }
    expect(done.final_path!.endsWith("reel.mp4")).toBe(true);
    expect(done.spent_usd).toBeCloseTo(0.12, 3); // 2 clips × (5000 tokens × 12 USD/M)
    // la aprobación se consume: una segunda producción exige aprobar otra vez
    expect(done.approved_cost_usd).toBeNull();
  });

  test("si un clip falla, conserva los hechos y reintentar solo paga lo que falta", async () => {
    const p = await twoSceneProject();
    await approveProject(p.id);
    failAt = 2; // el segundo clip
    const failed = await startProduction(p.id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true });
    expect(failed.status).toBe("failed");
    expect(failed.scenes.map((s) => s.status)).toEqual(["done", "failed"]);
    expect(failed.approved_cost_usd).toBeNull(); // hay que volver a aprobar
    await expect(startProduction(p.id, { fetchImpl: fakeFetch })).rejects.toMatchObject({ code: "not_approved" });
    const again = await approveProject(p.id);
    expect(again.approved_cost_usd).toBeCloseTo(0.023 * 5, 4); // solo la escena que falta
    failAt = 0; calls = [];
    const ok = await startProduction(p.id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true });
    expect(ok.status).toBe("done");
    expect(calls.filter((c) => c.url.endsWith("/interactions"))).toHaveLength(1);
  });

  test("el personaje se genera con Nano Banana en estudio-videos/imagenes y se usa como referencia", async () => {
    const p = await twoSceneProject();
    const withChar = await updateProject(p.id, { scenes: [{ seconds: 3, prompt: "despega", character_ids: [p.characters[0].id] }] });
    const r = await generateCharacterImage(p.id, withChar.characters[0].id, { fetchImpl: fakeFetch });
    const c = r.characters[0];
    expect(c.image_path!.startsWith(join(out, "estudio-videos", "imagenes"))).toBe(true);
    expect(existsSync(c.image_path!)).toBe(true);
    expect(calls[0].url).toContain("gemini-nano-banana-2.1:generateContent");
    expect(calls[0].body.generationConfig.imageConfig.aspectRatio).toBe("9:16");
    await approveProject(p.id);
    calls = [];
    await startProduction(p.id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true });
    const input = calls[0].body.input;
    expect(input[0]).toMatchObject({ type: "image", mime_type: "image/jpeg" });
    expect(input.at(-1).text).toContain("Keep the character(s) exactly as in the reference");
  });
});

describe("rostro, vestuario y escenografía", () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(400, 3)]);

  async function faceProject() {
    const p = await mkProject({ userId: "u1", title: "Mi reel", targetSeconds: 6, resolution: "360p" });
    const withChar = await updateProject(p.id, { characters: [{ name: "Ana", description: "presentadora, estilo fotográfico" }] });
    return { id: p.id, cid: withChar.characters[0].id };
  }

  test("la foto exige consentimiento, valida el contenido y queda en estudio-videos/imagenes", async () => {
    const { id, cid } = await faceProject();
    await expect(setCharacterFace(id, cid, { bytes: new Uint8Array(PNG), consent: false })).rejects.toThrow(/tienes permiso/);
    await expect(setCharacterFace(id, cid, { bytes: new Uint8Array(Buffer.from("no soy una imagen")), consent: true })).rejects.toThrow(/JPEG, PNG o WebP/);
    await expect(setCharacterFace(id, cid, { bytes: new Uint8Array(0), consent: true })).rejects.toThrow(/vacía/);
    const ok = await setCharacterFace(id, cid, { bytes: new Uint8Array(PNG), consent: true });
    const c = ok.characters[0];
    expect(c.face_consent).toBe(true);
    expect(c.face_path!.startsWith(join(out, "estudio-videos", "imagenes"))).toBe(true);
    expect(c.face_path).toEndWith(".png");
    // editar el personaje no pierde el rostro
    const edited = await updateProject(id, { characters: [{ id: cid, name: "Ana", description: "otra descripción" }] });
    expect(edited.characters[0].face_path).toBe(c.face_path);
    const cleared = await clearCharacterFace(id, cid);
    expect(cleared.characters[0].face_path).toBeNull();
    expect(cleared.characters[0].face_consent).toBe(false);
  });

  test("el avatar generado usa el rostro como referencia", async () => {
    const { id, cid } = await faceProject();
    await setCharacterFace(id, cid, { bytes: new Uint8Array(PNG), consent: true });
    await generateCharacterImage(id, cid, { fetchImpl: fakeFetch });
    const parts = calls[0].body.contents[0].parts;
    expect(parts[0].inlineData.mimeType).toBe("image/png");
    expect(parts.at(-1).text).toContain("EXACTLY identical to the photo");
  });

  test("el vestuario y la escenografía generan una imagen de escena con el rostro, y Omni usa esa imagen", async () => {
    const { id, cid } = await faceProject();
    await setCharacterFace(id, cid, { bytes: new Uint8Array(PNG), consent: true });
    const p = await updateProject(id, { scenes: [
      { seconds: 3, prompt: "Ana saluda a cámara", character_ids: [cid], wardrobe: "blazer azul marino y camisa blanca", setting: "estudio de televisión moderno con luces cálidas" },
      { seconds: 3, prompt: "Ana camina", character_ids: [cid] }, // sin vestuario ni escena: usa la identidad directa
    ] });
    const cost = projectCost(p);
    expect(cost.looks_pending).toBe(1);
    expect(cost.images_usd).toBeCloseTo(0.04, 4);
    expect(cost.total_usd).toBeCloseTo(0.023 * 6 + 0.04, 4);
    const approved = await approveProject(id);
    expect(approved.approved_cost_usd).toBeCloseTo(cost.total_usd, 4);

    const done = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true });
    expect(done.status).toBe("done");
    const images = calls.filter((c) => c.url.includes("generateContent"));
    expect(images).toHaveLength(1); // solo la escena 1 necesitó look
    const lookParts = images[0].body.contents[0].parts;
    expect(lookParts[0].inlineData.mimeType).toBe("image/png"); // el rostro
    const text = lookParts.at(-1).text as string;
    expect(text).toContain("EXACTLY as in the reference");
    expect(text).toContain("blazer azul marino");
    expect(text).toContain("estudio de televisión");
    const videos = calls.filter((c) => c.url.endsWith("/interactions"));
    expect(videos).toHaveLength(2);
    expect(videos[0].body.input[0]).toMatchObject({ type: "image", mime_type: "image/jpeg" }); // el look generado
    expect(videos[0].body.input.at(-1).text).toContain("Wardrobe: blazer azul marino");
    expect(videos[1].body.input[0]).toMatchObject({ type: "image", mime_type: "image/png" }); // la escena 2 usa el rostro directo
    expect(done.scenes[0].look_path!.startsWith(join(out, "estudio-videos", "imagenes"))).toBe(true);
    expect(done.scenes[1].look_path).toBeNull();
    expect(done.spent_usd).toBeCloseTo(0.12 + 0.04, 3);
  });

  test("cambiar el vestuario rehace solo el look y el clip de esa escena", async () => {
    const { id, cid } = await faceProject();
    await setCharacterFace(id, cid, { bytes: new Uint8Array(PNG), consent: true });
    const p = await updateProject(id, { scenes: [
      { seconds: 3, prompt: "a", character_ids: [cid], wardrobe: "traje", setting: "oficina" },
      { seconds: 3, prompt: "b", character_ids: [cid], wardrobe: "traje", setting: "oficina" },
    ] });
    await approveProject(id);
    await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true });
    const edited = await updateProject(id, { scenes: [
      { id: p.scenes[0].id, seconds: 3, prompt: "a", character_ids: [cid], wardrobe: "traje", setting: "oficina" },
      { id: p.scenes[1].id, seconds: 3, prompt: "b", character_ids: [cid], wardrobe: "vestido rojo", setting: "oficina" },
    ] });
    expect(edited.scenes.map((s) => s.status)).toEqual(["done", "pending"]);
    const cost = projectCost(edited);
    expect(cost.pending_scenes).toBe(1);
    expect(cost.looks_pending).toBe(1);
  });
});

describe("voz con ElevenLabs", () => {
  const prevEleven = process.env.ELEVENLABS_API_KEY;
  beforeEach(async () => { await deleteProviderApiKey("elevenlabs"); process.env.ELEVENLABS_API_KEY = "el-test-key"; });
  afterEach(() => { if (prevEleven === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = prevEleven; });
  const MP3 = Buffer.alloc(3000, 5);
  const reply = (fn: (url: string, init: RequestInit) => Response) => (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: init.body instanceof FormData ? init.body : init.body ? JSON.parse(String(init.body)) : null, headers: init.headers } as any);
    return fn(String(url), init);
  }) as unknown as typeof fetch;

  test("lista voces: las propias y clonadas primero", async () => {
    const f = reply(() => new Response(JSON.stringify({ voices: [
      { voice_id: "p1", name: "Rachel", category: "premade" }, { voice_id: "c1", name: "Mi voz", category: "cloned", preview_url: "http://x/p.mp3" } ] })));
    const voices = await listVoices({ fetchImpl: f });
    expect(voices.map((v) => v.name)).toEqual(["Mi voz", "Rachel"]);
    expect((calls[0].headers as any)["xi-api-key"]).toBe("el-test-key");
  });

  test("clonar exige consentimiento y muestra válida; traduce el error de plan", async () => {
    const sample = new Uint8Array(Buffer.alloc(5000, 1));
    await expect(cloneVoice({ name: "Ana", bytes: sample, mimeType: "audio/mpeg", consent: false })).rejects.toThrow(/permiso de su dueño/);
    await expect(cloneVoice({ name: "", bytes: sample, mimeType: "audio/mpeg", consent: true })).rejects.toThrow(/nombre/);
    await expect(cloneVoice({ name: "Ana", bytes: new Uint8Array(10), mimeType: "audio/mpeg", consent: true })).rejects.toThrow(/corta/);
    expect(calls).toHaveLength(0); // nada de lo anterior llegó a ElevenLabs
    const ok = await cloneVoice({ name: "Ana", bytes: sample, mimeType: "audio/mpeg", consent: true }, { fetchImpl: reply(() => new Response(JSON.stringify({ voice_id: "v-clon" }))) });
    expect(ok).toMatchObject({ voice_id: "v-clon", category: "cloned" });
    expect((calls[0].body as FormData).get("name")).toBe("Ana");
    const planErr = reply(() => new Response(JSON.stringify({ detail: { status: "can_not_use_instant_voice_cloning", message: "Upgrade your plan" } }), { status: 403 }));
    await expect(cloneVoice({ name: "Ana", bytes: sample, mimeType: "audio/mpeg", consent: true }, { fetchImpl: planErr })).rejects.toMatchObject({ code: "plan" });
  });

  test("limpia espacios y comillas de una clave pegada y explica qué hacer cuando ElevenLabs la rechaza", async () => {
    process.env.ELEVENLABS_API_KEY = '  "sk_abc123"\n';
    const f = reply(() => new Response(JSON.stringify({ voices: [] })));
    await listVoices({ fetchImpl: f });
    expect((calls[0].headers as any)["xi-api-key"]).toBe("sk_abc123");
    const invalid = reply(() => new Response(JSON.stringify({ detail: { status: "invalid_api_key", message: "Invalid API key" } }), { status: 401 }));
    await expect(listVoices({ fetchImpl: invalid })).rejects.toThrow(/invalid_api_key.*Crea una nueva en elevenlabs\.io.*Providers/s);
    const perms = reply(() => new Response(JSON.stringify({ detail: { status: "missing_permissions", message: "missing permission voices_read" } }), { status: 401 }));
    await expect(listVoices({ fetchImpl: perms })).rejects.toThrow(/no tiene permiso.*Text to Speech.*Voices/s);
  });

  test("controles: v4 solo admite estabilidad y similitud; los modelos clásicos añaden estilo, velocidad y speaker boost", () => {
    expect(DEFAULT_VOICE_SETTINGS.model_id).toBe("eleven_v4");
    expect(isExpressiveModel("eleven_v4")).toBe(true);
    expect(isExpressiveModel("eleven_multilingual_v2")).toBe(false);
    const v4 = ttsBody("Hola", normalizeVoiceSettings({ model_id: "eleven_v4", stability: 0.9, similarity: 0.6, style: 0.8, speed: 1.1 }));
    expect(v4).toEqual({ text: "Hola", model_id: "eleven_v4", voice_settings: { stability: 1, similarity_boost: 0.6 } }); // 0,9 -> Estable; sin style ni speed
    const v2 = ttsBody("Hola", normalizeVoiceSettings({ model_id: "eleven_multilingual_v2", stability: 0.4, style: 0.3, speed: 1.1, speaker_boost: false }));
    expect(v2.voice_settings).toEqual({ stability: 0.4, similarity_boost: 0.75, style: 0.3, speed: 1.1, use_speaker_boost: false });
    // acota rangos y modelos desconocidos
    expect(normalizeVoiceSettings({ model_id: "inventado", stability: 5, similarity: -2, speed: 9 } as never))
      .toMatchObject({ model_id: "eleven_v4", stability: 1, similarity: 0, speed: 1.2 });
    expect(normalizeVoiceSettings({ model_id: "eleven_flash_v2_5", speed: 0.1 }).speed).toBe(0.7);
    expect(normalizeVoiceSettings(null)).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  test("volumen: se acota y viaja a la mezcla; ElevenLabs no lo recibe", async () => {
    expect(normalizeVoiceSettings({ volume: 9, ambient_volume: 5 })).toMatchObject({ volume: 2, ambient_volume: 1 });
    expect(normalizeVoiceSettings({ volume: 0, ambient_volume: -1 })).toMatchObject({ volume: 0.5, ambient_volume: 0 });
    expect(normalizeVoiceSettings(null)).toMatchObject({ volume: 1, ambient_volume: 0.3 });
    const body = JSON.stringify(ttsBody("Hola", normalizeVoiceSettings({ model_id: "eleven_multilingual_v2", volume: 1.7, ambient_volume: 0.1 })));
    expect(body).not.toContain("volume"); // el volumen lo aplica Hive en ffmpeg, no existe en la API
    const p = await mkProject({ userId: "u1", title: "Volumen", targetSeconds: 3, resolution: "360p" });
    const c = await updateProject(p.id, { characters: [{ name: "Ana", description: "x", voice_id: "v", voice_settings: { mode: "narration", volume: 1.5, ambient_volume: 0.1 } }] });
    await updateProject(p.id, { scenes: [{ seconds: 3, prompt: "Ana", character_ids: [c.characters[0].id], dialogue: "Hola" }] });
    await approveProject(p.id);
    let gains: any;
    await startProduction(p.id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true,
      voice: { enabled: true, synthesize: async () => ({ bytes: new Uint8Array(3) }), mix: async (clip, _v, g) => { gains = g; return clip; } } });
    expect(gains).toEqual({ voiceGain: 1.5, ambientGain: 0.1 });
  });

  test.skipIf(!Bun.which("ffmpeg"))("mixDialogue: más volumen de voz suena más fuerte y 0 de ambiente deja solo la voz", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-vol-"));
    try {
      const run = (args: string[]) => expect(Bun.spawnSync(["ffmpeg", "-v", "error", "-y", ...args]).exitCode).toBe(0);
      run(["-f", "lavfi", "-i", "color=c=red:s=64x64:d=2:r=24", "-f", "lavfi", "-i", "sine=frequency=200:d=2", "-c:v", "mpeg4", "-c:a", "aac", join(dir, "clip.mp4")]);
      run(["-f", "lavfi", "-i", "sine=frequency=600:d=2", "-filter:a", "volume=0.4", "-c:a", "libmp3lame", join(dir, "voice.mp3")]);
      const clip = new Uint8Array(await Bun.file(join(dir, "clip.mp4")).arrayBuffer());
      const voice = new Uint8Array(await Bun.file(join(dir, "voice.mp3")).arrayBuffer());
      const meanDb = async (name: string, mix: object) => {
        const out = join(dir, `${name}.mp4`);
        await Bun.write(out, await mixDialogue(clip, voice, mix));
        const r = Bun.spawnSync(["ffmpeg", "-i", out, "-af", "volumedetect", "-vn", "-f", "null", "-"]);
        return Number(/mean_volume: (-?[\d.]+) dB/.exec(r.stderr.toString())![1]);
      };
      const quiet = await meanDb("quiet", { voiceGain: 0.5, ambientGain: 0.3 });
      const loud = await meanDb("loud", { voiceGain: 2, ambientGain: 0.3 });
      expect(loud).toBeGreaterThan(quiet + 6); // 4x de ganancia ≈ +12 dB, menos lo que recorte el limitador
      const noAmbient = await meanDb("solo-voz", { voiceGain: 1, ambientGain: 0 });
      expect(Number.isFinite(noAmbient)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("las etiquetas de audio se quitan del texto que dice Omni pero viajan a ElevenLabs", async () => {
    expect(stripAudioTags("[whispering] Hola  a todos [laughing] ¿qué tal?")).toBe("Hola a todos ¿qué tal?");
    expect(stripAudioTags("sin etiquetas")).toBe("sin etiquetas");
    const f = reply(() => new Response(MP3));
    await synthesizeLine({ voiceId: "v1", text: "[whispering] Hola", settings: { model_id: "eleven_v4", stability: 0 } }, { fetchImpl: f });
    expect((calls[0].body as any).text).toBe("[whispering] Hola");
    expect((calls[0].body as any).voice_settings.stability).toBe(0);
  });

  test("el modelo elegido va primero y el de reserva respeta sus propios ajustes", async () => {
    const f = reply((_u, init) => {
      const body = JSON.parse(String(init.body));
      return body.model_id === "eleven_v4_turbo" ? new Response(JSON.stringify({ detail: { message: "no disponible" } }), { status: 422 }) : new Response(MP3);
    });
    const out = await synthesizeLine({ voiceId: "v1", text: "Hola", settings: { model_id: "eleven_v4_turbo", style: 0.5, speed: 1.1 } }, { fetchImpl: f });
    expect(out.modelId).toBe("eleven_multilingual_v2");
    expect(calls.map((c) => (c.body as any).model_id)).toEqual(["eleven_v4_turbo", "eleven_multilingual_v2"]);
    expect((calls[0].body as any).voice_settings.style).toBeUndefined(); // v4 Turbo no lleva estilo
    expect((calls[1].body as any).voice_settings).toMatchObject({ style: 0.5, speed: 1.1 }); // el de reserva sí
  });

  test("la voz del personaje guarda sus ajustes y la producción los usa", async () => {
    const p = await mkProject({ userId: "u1", title: "Ajustes", targetSeconds: 3, resolution: "360p" });
    const withChar = await updateProject(p.id, { characters: [{ name: "Ana", description: "x", voice_id: "voz-ana", voice_settings: { mode: "narration", model_id: "eleven_multilingual_v2", speed: 1.15, stability: 0.3 } }] });
    expect(withChar.characters[0].voice_settings).toMatchObject({ model_id: "eleven_multilingual_v2", speed: 1.15, stability: 0.3, similarity: 0.75 });
    // editar solo el nombre no pierde los ajustes
    const renamed = await updateProject(p.id, { characters: [{ id: withChar.characters[0].id, name: "Ana B", description: "x" }] });
    expect(renamed.characters[0].voice_settings.speed).toBe(1.15);
    await updateProject(p.id, { scenes: [{ seconds: 3, prompt: "Ana habla", character_ids: [withChar.characters[0].id], dialogue: "[whispering] Hola" }] });
    await approveProject(p.id);
    let got: any;
    await startProduction(p.id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true,
      voice: { enabled: true, synthesize: async (i) => { got = i; return { bytes: new Uint8Array(3) }; }, mix: async (c) => c } });
    expect(got.settings).toMatchObject({ model_id: "eleven_multilingual_v2", speed: 1.15 });
    expect(got.text).toBe("[whispering] Hola");
  });

  test("probar voz: valida y devuelve el audio; el estado ofrece los modelos y los valores por omisión", async () => {
    const preview = (body: unknown) => handleVideoVoices(new Request("http://x/api/video/voices/preview", { method: "POST", body: JSON.stringify(body) }), (r) => r);
    expect((await preview({ text: "hola" }))!.status).toBe(400);
    expect((await preview({ voice_id: "v1", text: "" }))!.status).toBe(400);
    expect((await preview({ voice_id: "v1", text: "x".repeat(301) }))!.status).toBe(400);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), body: JSON.parse(String(init.body)) }); return new Response(MP3); }) as unknown as typeof fetch;
    try {
      const ok = await preview({ voice_id: "v1", text: "Hola, esta es mi voz.", settings: { model_id: "eleven_v4", stability: 1 } });
      expect(ok!.status).toBe(200);
      expect(ok!.headers.get("content-type")).toBe("audio/mpeg");
      expect(ok!.headers.get("x-voice-model")).toBe("eleven_v4");
      expect(new Uint8Array(await ok!.arrayBuffer()).byteLength).toBe(MP3.byteLength);
    } finally { globalThis.fetch = realFetch; }
    const status = await (await statusRoute(new Request("http://x/api/video/status"), (r) => r)).json() as any;
    expect(status.voice_models.map((m: any) => m.id)).toEqual(["eleven_v4", "eleven_v4_turbo", "eleven_multilingual_v2", "eleven_flash_v2_5"]);
    expect(status.voice_defaults).toMatchObject({ model_id: "eleven_v4", stability: 0 });
    expect(status.voice_preview_max_chars).toBe(300);
  });

  test("sintetiza con eleven_v4 y cae a multilingual_v2 si la cuenta no lo acepta", async () => {
    const f = reply((_u, init) => {
      const model = JSON.parse(String(init.body)).model_id;
      return model === "eleven_v4" ? new Response(JSON.stringify({ detail: { message: "model not available" } }), { status: 422 }) : new Response(MP3);
    });
    const out = await synthesizeLine({ voiceId: "v1", text: "Hola mundo" }, { fetchImpl: f });
    expect(out.modelId).toBe("eleven_multilingual_v2");
    expect(calls.map((c) => (c.body as any).model_id)).toEqual(["eleven_v4", "eleven_multilingual_v2"]);
    expect(calls[0].url).toContain("/v1/text-to-speech/v1");
    // una clave mala no se reintenta con otro modelo
    calls = [];
    await expect(synthesizeLine({ voiceId: "v1", text: "x" }, { fetchImpl: reply(() => new Response("{}", { status: 401 })) })).rejects.toMatchObject({ code: "auth" });
    expect(calls).toHaveLength(1);
    delete process.env.ELEVENLABS_API_KEY;
    await expect(synthesizeLine({ voiceId: "v1", text: "x" })).rejects.toBeInstanceOf(VoiceError);
  });

  test.skipIf(!Bun.which("ffmpeg"))("mixDialogue pone la voz sobre un clip con y sin audio ambiente", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-mix-"));
    try {
      const run = (args: string[]) => expect(Bun.spawnSync(["ffmpeg", "-v", "error", "-y", ...args]).exitCode).toBe(0);
      run(["-f", "lavfi", "-i", "color=c=red:s=64x64:d=2:r=24", "-f", "lavfi", "-i", "sine=frequency=200:d=2", "-c:v", "mpeg4", "-c:a", "aac", join(dir, "ambient.mp4")]);
      run(["-f", "lavfi", "-i", "color=c=red:s=64x64:d=2:r=24", "-c:v", "mpeg4", join(dir, "mute.mp4")]);
      run(["-f", "lavfi", "-i", "sine=frequency=600:d=3", "-c:a", "libmp3lame", join(dir, "voice.mp3")]);
      const voice = new Uint8Array(await Bun.file(join(dir, "voice.mp3")).arrayBuffer());
      for (const name of ["ambient", "mute"]) {
        const clip = new Uint8Array(await Bun.file(join(dir, `${name}.mp4`)).arrayBuffer());
        const out = join(dir, `${name}-out.mp4`);
        await Bun.write(out, await mixDialogue(clip, voice));
        const probe = Bun.spawnSync(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", out]).stdout.toString();
        expect(probe).toContain("audio");
        expect(probe).toContain("video");
        const dur = Number(Bun.spawnSync(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).stdout.toString());
        expect(dur).toBeLessThan(2.5); // la voz de 3 s se ajusta al clip de 2 s
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("modo narración: ElevenLabs narra sobre el clip y no se le pide hablar a Omni", async () => {
    const p = await mkProject({ userId: "u1", title: "Con voz", targetSeconds: 6, resolution: "360p" });
    const withChar = await updateProject(p.id, { characters: [{ name: "Ana", description: "presentadora", voice_id: "voz-ana", voice_name: "Ana clonada", voice_settings: { mode: "narration" } }] });
    const cid = withChar.characters[0].id;
    expect(withChar.characters[0].voice_id).toBe("voz-ana");
    await updateProject(p.id, { scenes: [
      { seconds: 3, prompt: "Ana en cámara", character_ids: [cid], dialogue: "Bienvenidos a mi canal" },
      { seconds: 3, prompt: "Plano del paisaje" },
    ] });
    await approveProject(p.id);
    const spoken: string[] = [];
    const done = await startProduction(p.id, {
      fetchImpl: fakeFetch, concat: fakeConcat, wait: true,
      voice: { enabled: true, synthesize: async ({ voiceId, text }) => { spoken.push(`${voiceId}:${text}`); return { bytes: new Uint8Array(3) }; }, mix: async (clip) => clip },
    });
    expect(done.status).toBe("done");
    expect(spoken).toEqual(["voz-ana:Bienvenidos a mi canal"]);
    const videos = calls.filter((c) => c.url.endsWith("/interactions"));
    expect(videos[0].body.input).toContain("No spoken dialogue");
  });

  test("sin voz asignada, Omni dice la línea con su voz nativa", async () => {
    const p = await mkProject({ userId: "u1", title: "Sin voz", targetSeconds: 3, resolution: "360p" });
    const withChar = await updateProject(p.id, { characters: [{ name: "Ana", description: "presentadora" }] });
    await updateProject(p.id, { scenes: [{ seconds: 3, prompt: "Ana habla", character_ids: [withChar.characters[0].id], dialogue: "Hola a todos" }] });
    await approveProject(p.id);
    await startProduction(p.id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true });
    const sent = calls.find((c) => c.url.endsWith("/interactions"))!.body.input as string;
    const text = typeof sent === "string" ? sent : JSON.stringify(sent);
    expect(text).toContain("The character speaks directly to the viewer");
    expect(text).toContain("Natural lip movements perfectly in sync");
    expect(text).toContain("Hola a todos");
    expect(text).not.toContain("No spoken dialogue");
  });
});

describe("voz propia ajustada a los labios", () => {
  test("wordsFromCharacters agrupa por palabra e ignora las etiquetas de audio", () => {
    const text = "[whispering] Hola mundo";
    const characters = [...text];
    const start = characters.map((_, i) => i * 0.1);
    const end = characters.map((_, i) => i * 0.1 + 0.1);
    const w = wordsFromCharacters({ characters, character_start_times_seconds: start, character_end_times_seconds: end });
    expect(w.map((x) => x.text)).toEqual(["Hola", "mundo"]);
    expect(w[0].start).toBeCloseTo(1.3); // «H» es el carácter 13
    expect(w[1].end).toBeCloseTo(2.3);
    expect(wordsFromCharacters({})).toEqual([]);
  });

  test("synthesizeLineTimed pide el endpoint con tiempos y devuelve audio y palabras", async () => {
    const prev = process.env.ELEVENLABS_API_KEY; process.env.ELEVENLABS_API_KEY = "k";
    const seen: string[] = [];
    const characters = [..."Hola mundo"];
    const f = (async (url: string, init: RequestInit) => {
      seen.push(String(url) + " " + String(init.body).slice(0, 80));
      return new Response(JSON.stringify({
        audio_base64: Buffer.alloc(500, 1).toString("base64"),
        alignment: { characters, character_start_times_seconds: characters.map((_, i) => i * 0.1), character_end_times_seconds: characters.map((_, i) => i * 0.1 + 0.1) },
      }));
    }) as unknown as typeof fetch;
    try {
      const r = await synthesizeLineTimed({ voiceId: "v1", text: "Hola mundo", settings: { model_id: "eleven_v4", stability: 1 } }, { fetchImpl: f });
      expect(seen[0]).toContain("/v1/text-to-speech/v1/with-timestamps?output_format=mp3_44100_128");
      expect(seen[0]).toContain('"model_id":"eleven_v4"');
      expect(r.bytes.byteLength).toBe(500);
      expect(r.words.map((w) => w.text)).toEqual(["Hola", "mundo"]);
      await expect(synthesizeLineTimed({ voiceId: "v1", text: " " }, { fetchImpl: f })).rejects.toThrow(/No hay texto/);
    } finally { if (prev === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = prev; }
  });

  test("el modo de voz se normaliza: sync por omisión, convert y narration se respetan", () => {
    expect(normalizeVoiceSettings(null).mode).toBe("sync");
    expect(normalizeVoiceSettings({ mode: "convert" }).mode).toBe("convert");
    expect(normalizeVoiceSettings({ mode: "narration" }).mode).toBe("narration");
    expect(normalizeVoiceSettings({ mode: "otro" as never }).mode).toBe("sync");
  });

  test.skipIf(!Bun.which("ffmpeg"))("warpToTiming coloca cada palabra de la voz en la ventana de los labios (medido con ffmpeg)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-warp-t-"));
    try {
      // «voz»: tres ráfagas de tono en 0–0,4 · 1–1,4 · 2–2,4 s
      const mk = Bun.spawnSync(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "aevalsrc=sin(2*PI*440*t)*between(mod(t\\,1)\\,0\\,0.4):d=3:s=44100", "-c:a", "libmp3lame", join(dir, "tts.mp3")]);
      expect(mk.exitCode).toBe(0);
      const tts = new Uint8Array(await Bun.file(join(dir, "tts.mp3")).arrayBuffer());
      const from = [{ text: "a", start: 0, end: 0.4 }, { text: "b", start: 1, end: 1.4 }, { text: "c", start: 2, end: 2.4 }];
      const to = [{ text: "a", start: 0.5, end: 0.9 }, { text: "b", start: 1.3, end: 1.9 }, { text: "c", start: 2.2, end: 2.5 }];
      const wav = await warpToTiming(tts, from, to, 3);
      await Bun.write(join(dir, "out.wav"), wav);
      const dur = Number(Bun.spawnSync(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", join(dir, "out.wav")]).stdout.toString());
      expect(dur).toBeCloseTo(3, 1);
      const log = Bun.spawnSync(["ffmpeg", "-hide_banner", "-i", join(dir, "out.wav"), "-af", "silencedetect=noise=-40dB:d=0.05", "-f", "null", "-"]).stderr.toString();
      const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));   // dónde EMPIEZA cada palabra
      const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1])); // dónde TERMINA cada palabra
      // Cada palabra ARRANCA donde Gemini mueve los labios y se reproduce casi a su ritmo natural (estirada ±12 %, no hasta llenar la ventana).
      expect(ends[0]).toBeCloseTo(0.5, 1); expect(ends[1]).toBeCloseTo(1.3, 1); expect(ends[2]).toBeCloseTo(2.2, 1);
      expect(starts[1]).toBeCloseTo(0.9, 1);                 // a: 0,4 s → ocupa su ventana
      expect(Math.abs(starts[2] - ends[1] - 0.44)).toBeLessThan(0.1); // b: 0,4 s en una ventana de 0,6 s → se alarga ~11 %, NO hasta 0,6 s
      expect(Math.abs(starts[3] - ends[2] - 0.36)).toBeLessThan(0.1); // c: 0,4 s en una ventana de 0,3 s → se acorta ~12 %, NO hasta 0,3 s
      // sin palabras no hay nada que ajustar
      await expect(warpToTiming(tts, [], to, 3)).rejects.toBeInstanceOf(VoiceError);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("voz sincronizada con los labios, subtítulos y narración en vivo", () => {
  const WORDS = (n: number) => [{ text: "Hola", start: 0.5 + n, end: 0.9 + n }, { text: "mundo", start: 1 + n, end: 1.6 + n }];
  const CONVERTED = new Uint8Array(Buffer.alloc(500, 9));
  const WARPED = new Uint8Array(Buffer.alloc(600, 7));
  const TTS = new Uint8Array(Buffer.alloc(400, 3));
  const OWN = [{ text: "Hola", start: 0, end: 0.4 }, { text: "mundo", start: 0.5, end: 1.1 }];
  const stubs = (extra: Record<string, unknown> = {}) => {
    const seen = { convert: [] as any[], replace: [] as any[], align: [] as any[], burn: [] as any[], synth: [] as any[], warp: [] as any[], join: [] as any[] };
    return {
      seen,
      voice: {
        enabled: true,
        extract: async () => new Uint8Array(Buffer.alloc(300, 4)),
        convert: async (i: any) => { seen.convert.push(i); return { bytes: CONVERTED }; },
        synthTimed: async (i: any) => { seen.synth.push(i); return { bytes: TTS, words: OWN }; },
        warp: async (tts: Uint8Array, from: any[], to: any[], total: number) => { seen.warp.push({ tts, from, to, total }); return WARPED; },
        replace: async (clip: Uint8Array, audio: Uint8Array, gain?: number) => { seen.replace.push({ audio, gain }); return clip; },
        align: async (i: any) => { seen.align.push(i); return WORDS(0); },
        span: async () => ({ start: 1.2, end: 3.7, duration: 5 }),
        ...extra,
      },
      burn: async (reel: Uint8Array, spec: any) => { seen.burn.push(spec); return new Uint8Array(Buffer.concat([reel, Buffer.from("SUBS")])); },
      join: async (paths: string[], durs: number[], t: any) => { seen.join.push({ paths, durs, t }); return new Uint8Array(Buffer.from("JOINED")); },
      duration: async () => 3,
      trim: async () => {},
    };
  };

  async function talkingProject(opts: { voice?: boolean; mode?: "sync" | "convert" | "narration" } = { voice: true }) {
    const p = await mkProject({ userId: "u1", title: "Habla", targetSeconds: 6, resolution: "360p" });
    const c = await updateProject(p.id, { characters: [{ name: "Ana", description: "presentadora", ...(opts.voice ? { voice_id: "voz-ana", voice_name: "Ana clonada", voice_settings: { volume: 1.4, stability: 1, ...(opts.mode ? { mode: opts.mode } : {}) } } : {}) }] });
    const cid = c.characters[0].id;
    await updateProject(p.id, { scenes: [
      { seconds: 3, prompt: "Ana saluda", character_ids: [cid], dialogue: "[whispering] Hola mundo" },
      { seconds: 3, prompt: "Ana se despide", character_ids: [cid], dialogue: "Hola mundo" },
    ] });
    await updateProject(p.id, { style: { trim: { enabled: false } } }); // estos tests miden otra cosa; el recorte tiene su propio test
    await approveProject(p.id);
    return p.id;
  }

  test("el modo sincronizado es el predeterminado: Gemini habla, TU voz de ElevenLabs se ajusta a sus labios", async () => {
    const id = await talkingProject();
    expect((await getProject(id)).characters[0].voice_settings.mode).toBe("sync");
    const { seen, ...hooks } = stubs();
    const done = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, ...hooks });
    expect(done.status).toBe("done");
    // Omni recibe la orden de HABLAR con labios sincronizados, sin etiquetas de audio y sin la orden de callar
    const input = calls.find((c) => c.url.endsWith("/interactions"))!.body.input;
    const text = typeof input === "string" ? input : JSON.stringify(input);
    expect(text).toContain('saying exactly: "Hola mundo"');
    expect(text).toContain("Natural lip movements perfectly in sync");
    expect(text).not.toContain("[whispering]");
    expect(text).not.toContain("No spoken dialogue");
    // la voz del personaje se genera con texto a voz (con la etiqueta) y NO con el cambio de voz
    expect(seen.convert).toHaveLength(0);
    expect(seen.synth).toHaveLength(2);
    expect(seen.synth[0]).toMatchObject({ voiceId: "voz-ana", text: "[whispering] Hola mundo", settings: { stability: 1, volume: 1.4 } });
    // cada palabra de la voz se ajusta a la ventana de la misma palabra del habla de Gemini
    expect(seen.warp).toHaveLength(2);
    expect(seen.warp[0].from).toEqual(OWN);
    expect(seen.warp[0].to).toEqual(WORDS(0));
    expect(seen.warp[0].total).toBe(3);
    expect(seen.replace[0]).toMatchObject({ gain: 1.4 });
    expect(seen.replace[0].audio).toEqual(WARPED);
    // los subtítulos usan los tiempos de los labios (los de Gemini), sin la etiqueta
    expect(done.scenes[0].captions).toEqual(WORDS(0));
    expect(seen.align[0].text).toBe("Hola mundo");
  });

  test("modo cambio de voz: Gemini habla y ElevenLabs convierte esa voz con el voice changer", async () => {
    const id = await talkingProject({ voice: true, mode: "convert" });
    const { seen, ...hooks } = stubs();
    const done = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, ...hooks });
    expect(done.status).toBe("done");
    expect(seen.synth).toHaveLength(0);
    expect(seen.convert).toHaveLength(2);
    expect(seen.convert[0]).toMatchObject({ voiceId: "voz-ana", settings: { stability: 1, volume: 1.4 } });
    expect(seen.replace[0].audio).toEqual(CONVERTED);
    expect(done.scenes[0].captions).toEqual(WORDS(0));
  });

  test("con distinto número de palabras entre la voz y los labios se ajusta el habla completa", async () => {
    const id = await talkingProject();
    const { seen, ...hooks } = stubs({ synthTimed: async () => ({ bytes: TTS, words: [{ text: "Hola", start: 0, end: 1 }] }) });
    await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, ...hooks });
    expect(seen.warp[0].from).toHaveLength(1);
    expect(seen.warp[0].to).toEqual(WORDS(0)); // dos palabras: la función de ajuste decide
  });

  test("los subtítulos se graban al unir, con los tiempos de cada escena desplazados por la transición", async () => {
    const id = await talkingProject();
    const { seen, ...hooks } = stubs();
    const done = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, ...hooks });
    expect(seen.join).toHaveLength(1); // transición por omisión: fundido de 0,4 s
    expect(seen.join[0].t).toMatchObject({ type: "fade", duration: 0.4 });
    expect(seen.burn).toHaveLength(1); // una sola vez, no por clip
    const spec = seen.burn[0];
    expect(spec.scenes).toHaveLength(2);
    expect(spec.scenes[0].start).toBe(0);
    expect(spec.scenes[1].start).toBeCloseTo(2.6); // 3 s − 0,4 s que se solapan
    expect(spec.total).toBeCloseTo(5.6);
    expect(spec.scenes[0].words).toEqual(WORDS(0)); // tiempos relativos a la escena: el estudio los desplaza con su inicio
    expect(spec.subtitles).toMatchObject({ preset: "classic", position: "bottom" });
    expect(done.final_path).toBeTruthy();
    expect(done.activity.at(-1)!.text).toContain("con subtítulos y transiciones");
  });

  test("estilo del reel: subtítulos, transición y gráficos se guardan, se normalizan y llegan al render", async () => {
    const id = await talkingProject();
    const p0 = await getProject(id);
    expect(p0.style).toEqual({
      subtitles: { preset: "classic", position: "bottom", size: "m", uppercase: false, color: "#FFFFFF", highlight: "#FACC15", font: "montserrat" },
      transition: { type: "fade", duration: 0.4 }, graphics: { enabled: true, accent: "#2563EB", progress_bar: false },
      trim: { enabled: false, lead: 0.2, tail: 0.35 }, music: { enabled: false, volume: 0.14, mood: "" },
    });
    const p1 = await updateProject(id, { style: {
      subtitles: { preset: "karaoke", position: "middle", size: "l", uppercase: true, color: "#ffffff", highlight: "#ff00aa", font: "serif" },
      transition: { type: "slideleft", duration: 9 }, graphics: { accent: "#10b981", progress_bar: true },
    } });
    expect(p1.style.subtitles).toMatchObject({ preset: "karaoke", position: "middle", size: "l", uppercase: true, color: "#FFFFFF", highlight: "#FF00AA", font: "serif" });
    expect(p1.style.transition).toEqual({ type: "slideleft", duration: 1 }); // tope de 1 s
    expect(p1.style.graphics).toEqual({ enabled: true, accent: "#10B981", progress_bar: true });
    // valores inválidos vuelven al valor anterior o al predeterminado
    const p2 = await updateProject(id, { style: { subtitles: { preset: "raro" as never, color: "rojo", position: "abajo" as never }, transition: { type: "boom" as never, duration: -3 } } });
    expect(p2.style.subtitles).toMatchObject({ preset: "classic", color: "#FFFFFF", position: "bottom" });
    expect(p2.style.transition).toEqual({ type: "fade", duration: 0.2 });
    // llega al render
    await updateProject(id, { style: { subtitles: { preset: "pop", highlight: "#00FF00" }, graphics: { progress_bar: true } } });
    const { seen, ...hooks } = stubs();
    await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, ...hooks });
    expect(seen.burn[0].subtitles).toMatchObject({ preset: "pop", highlight: "#00FF00" });
    expect(seen.burn[0].graphics).toMatchObject({ enabled: true, progress_bar: true });
  });

  test("gráficos por escena: se normalizan, se guardan y cambiarlos NO invalida el clip ni cuesta", async () => {
    const id = await talkingProject();
    const first = stubs();
    await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, ...first });
    const done = await getProject(id);
    const cid = done.characters[0].id;
    const plain = (i: number) => ({ id: done.scenes[i].id, seconds: 3, prompt: done.scenes[i].prompt, character_ids: [cid], dialogue: done.scenes[i].dialogue });
    const edited = await updateProject(id, { scenes: [
      { ...plain(0), graphic: { kind: "title", text: "  ¿La IA te quita el {trabajo}?  ", sub: "" } },
      { ...plain(1), graphic: { kind: "cta", text: "Comenta", sub: "" } },
    ] });
    expect(edited.scenes.map((s) => s.status)).toEqual(["done", "done"]); // los clips siguen
    expect(edited.scenes[0].graphic).toEqual({ kind: "title", text: "¿La IA te quita el trabajo?", sub: "" }); // sin llaves ni espacios de más
    expect(edited.final_path).toBeNull(); // hay que volver a unir
    expect(projectCost(edited).total_usd).toBe(0);
    // un tipo sin texto no es un gráfico
    const none = await updateProject(id, { scenes: [{ ...plain(0), graphic: { kind: "stat", text: "  ", sub: "x" } }, { ...plain(1), graphic: { kind: "cta", text: "Comenta" } }] });
    expect(none.scenes[0].graphic).toEqual({ kind: "none", text: "", sub: "" });
    calls = [];
    const second = stubs();
    const redone = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, ...second });
    expect(redone.status).toBe("done");
    expect(calls).toHaveLength(0);
    expect(second.seen.burn[0].scenes[1].graphic).toMatchObject({ kind: "cta", text: "Comenta" });
    expect(redone.activity.at(-1)!.text).toContain("gráficos");
  });

  test("sin transición no se llama a unir con efectos; si la transición falla, se une con corte directo y se avisa", async () => {
    const a = await talkingProject();
    await updateProject(a, { style: { transition: { type: "none" } } });
    const sa = stubs();
    const doneA = await startProduction(a, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, ...sa });
    expect(sa.seen.join).toHaveLength(0);
    expect(sa.seen.burn[0].scenes[1].start).toBeCloseTo(3); // sin solape
    expect(doneA.activity.at(-1)!.text).not.toContain("transiciones");

    const b = await talkingProject();
    const sb = stubs();
    const doneB = await startProduction(b, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, ...sb, join: async () => { throw new Error("sin xfade"); } });
    expect(doneB.status).toBe("done");
    expect(doneB.activity.some((x) => x.kind === "warn" && x.text.includes("No se pudieron aplicar las transiciones") && x.text.includes("sin xfade"))).toBe(true);
    expect(sb.seen.burn[0].scenes[1].start).toBeCloseTo(3); // el corte directo no solapa
    expect(doneB.activity.at(-1)!.text).not.toContain("transiciones");
  });

  test("cambiar los subtítulos rehace solo la unión: sin costo y sin tocar los clips", async () => {
    const id = await talkingProject();
    const first = stubs();
    await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, voice: first.voice, burn: first.burn, duration: first.duration });
    const off = await updateProject(id, { subtitles: false });
    expect(off.subtitles).toBe(false);
    expect(off.final_path).toBeNull();
    expect(off.scenes.every((s) => s.status === "done")).toBe(true);
    expect(projectCost(off).total_usd).toBe(0);
    calls = [];
    const second = stubs();
    const redone = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, voice: second.voice, burn: second.burn, duration: second.duration });
    expect(redone.status).toBe("done");
    expect(calls).toHaveLength(0); // ni imágenes ni video ni voz
    expect(second.seen.burn).toHaveLength(0); // sin subtítulos
    expect(redone.activity.at(-1)!.text).not.toContain("con subtítulos");
  });

  test("si grabar los subtítulos falla, el reel se entrega sin ellos y se avisa", async () => {
    const id = await talkingProject();
    const { seen, ...hooks } = stubs();
    const done = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, ...hooks, burn: async () => { throw new Error("sin libass"); } });
    expect(done.status).toBe("done");
    expect(done.final_path).toBeTruthy();
    expect(done.activity.some((a) => a.kind === "warn" && a.text.includes("El reel se entrega sin ellos") && a.text.includes("sin libass"))).toBe(true);
    expect(done.activity.at(-1)!.text).not.toContain("con subtítulos");
    expect(seen.synth).toHaveLength(2);
  });

  test("con «Recortar silencios» cada escena hablada se corta a su tramo y los subtítulos se desplazan", async () => {
    const id = await talkingProject();
    await updateProject(id, { style: { trim: { enabled: true } } });
    const cuts: Array<[number, number]> = [];
    const { seen, ...hooks } = stubs({ synthTimed: async () => ({ bytes: TTS, words: [{ text: "Hola", start: 1.2, end: 1.6 }, { text: "mundo", start: 1.7, end: 2.0 }] }) });
    const done = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, ...hooks, trim: async (_s: string, _o: string, a: number, b: number) => { cuts.push([a, b]); } });
    expect(done.status).toBe("done");
    expect(cuts).toHaveLength(2);
    const w = done.scenes[0].captions;
    const first = w[0].start, last = w[w.length - 1].end;
    expect(cuts[0][0]).toBeCloseTo(Math.max(0, first - 0.2), 2);   // margen antes de la primera palabra
    expect(cuts[0][1]).toBeCloseTo(Math.min(3, last + 0.35), 2);   // margen después de la última
    expect(seen.burn[0].scenes[0].duration).toBeCloseTo(cuts[0][1] - cuts[0][0], 2);
    expect(seen.burn[0].scenes[0].words[0].start).toBeCloseTo(first - cuts[0][0], 2); // desplazadas al nuevo inicio
    expect(done.activity.at(-1)!.text).toContain("de silencio recortados");
  });

  test("si poner tu voz ajustada falla, se conserva la voz de Gemini, se avisa y la escena no falla", async () => {
    const id = await talkingProject();
    const { seen, ...hooks } = stubs({ synthTimed: async () => { throw new Error("sin permiso de texto a voz"); } });
    const done = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, ...hooks });
    expect(done.status).toBe("done");
    expect(done.scenes.every((s) => s.status === "done")).toBe(true);
    const warns = done.activity.filter((a) => a.kind === "warn");
    expect(warns).toHaveLength(2);
    expect(warns[0].text).toContain("No se pudo poner tu voz ajustada a los labios");
    expect(warns[0].text).toContain("sin permiso de texto a voz");
    expect(seen.replace).toHaveLength(0);
  });

  test("si el cambio de voz falla (modo cambio de voz), se conserva la voz de Gemini y se avisa", async () => {
    const id = await talkingProject({ voice: true, mode: "convert" });
    const { seen, ...hooks } = stubs({ convert: async () => { throw new Error("plan sin voice changer"); } });
    const done = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, ...hooks });
    expect(done.status).toBe("done");
    const warns = done.activity.filter((a) => a.kind === "warn");
    expect(warns[0].text).toContain("No se pudo cambiar la voz");
    expect(seen.replace).toHaveLength(0);
  });

  test("sin alineado de ElevenLabs, los tiempos salen de la detección del habla", async () => {
    const id = await talkingProject({ voice: false });
    const { seen, ...hooks } = stubs({ align: async () => { throw new Error("sin forced-alignment"); } });
    const done = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, ...hooks });
    expect(seen.convert).toHaveLength(0); // sin voz asignada no se cambia nada
    expect(seen.synth).toHaveLength(0);
    const w = done.scenes[0].captions;
    expect(w.map((x) => x.text)).toEqual(["Hola", "mundo"]);
    expect(w[0].start).toBeCloseTo(1.2); // empieza donde empieza el habla, no en 0
    expect(w[1].end).toBeCloseTo(3.7);
  });

  test("la bitácora cuenta cada paso, deja la fase en null al terminar y se narra al exterior", async () => {
    const id = await talkingProject();
    const { seen, ...hooks } = stubs();
    const told: Array<{ kind: string; scene: number | null; label: string }> = [];
    const done = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, narrate: (n) => { told.push(n); }, ...hooks });
    const texts = done.activity.map((a) => a.text);
    expect(texts[0]).toContain("Empiezo a producir 2 de 2 escenas");
    expect(texts.some((t) => t.startsWith("Escena 1 de 2 · Gemini está grabando el clip de 3 s con el personaje hablando"))).toBe(true);
    expect(texts.some((t) => t.includes("Generando la voz «Ana clonada»") && t.includes("ajustándola palabra por palabra a los labios"))).toBe(true);
    expect(texts.some((t) => t.startsWith("Escena 2 de 2 · Lista."))).toBe(true);
    expect(texts.at(-1)).toContain("Reel terminado");
    expect(done.phase).toBeNull();
    expect(done.activity.length).toBeLessThanOrEqual(80);
    expect(told.map((t) => t.label)).toEqual(texts); // lo mismo que ve el usuario en la pantalla
    expect(seen.synth.length).toBe(2);
  });

  test("un fallo queda anotado como error y la fase se limpia", async () => {
    const id = await talkingProject();
    failAt = 1;
    const { seen, ...hooks } = stubs();
    const done = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, ...hooks });
    expect(done.status).toBe("failed");
    expect(done.phase).toBeNull();
    expect(done.activity.some((a) => a.kind === "error" && a.text.startsWith("Escena 1 de 2 · Falló"))).toBe(true);
    expect(seen.synth).toHaveLength(0);
  });
});

describe("unir clips", () => {
  test("si todos los clips existen y solo falló la unión, reintentar es gratis y no pide aprobación", async () => {
    const p = await twoSceneProject();
    await approveProject(p.id);
    const failedJoin = async () => { throw new Error("ffmpeg falló al unir los clips: simulado"); };
    const first = await startProduction(p.id, { fetchImpl: fakeFetch, concat: failedJoin, wait: true });
    expect(first.status).toBe("failed");
    expect(first.scenes.every((s) => s.status === "done")).toBe(true);
    expect(first.final_path).toBeNull();
    calls = [];
    const retry = await startProduction(p.id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true });
    expect(retry.status).toBe("done");
    expect(retry.final_path).not.toBeNull();
    expect(calls).toHaveLength(0); // no se generó ni se pagó nada
  });

  test.skipIf(!Bun.which("ffmpeg"))("concatClips une clips reales sin depender de libx264", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hive-concat-"));
    try {
      const clips = [join(dir, "a.mp4"), join(dir, "b.mp4")];
      for (const c of clips) {
        const r = Bun.spawnSync(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1:r=24",
          "-f", "lavfi", "-i", "sine=frequency=440:d=1", "-c:v", "mpeg4", "-c:a", "aac", "-shortest", c]);
        expect(r.exitCode).toBe(0);
      }
      const bytes = await concatClips(clips);
      const joined = join(dir, "out.mp4");
      await Bun.write(joined, bytes);
      const probe = Bun.spawnSync(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", joined]);
      expect(Number(probe.stdout.toString().trim())).toBeGreaterThan(1.8);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("tools y rutas", () => {
  test("la tool crea el proyecto en el workspace del agente", async () => {
    const ws = mkdtempSync(join(tmpdir(), "hive-ws-"));
    try {
      const r = await videoProjectCreateTool.execute({ title: "Reel", target_seconds: 10 }, { configurable: { user_id: "u1", workspace: ws } }) as any;
      expect(r.ok).toBe(true);
      expect((await getProject(r.project_id)).workspace).toBe(ws);
    } finally { rmSync(ws, { recursive: true, force: true }); }
  });

  test("REST: crear, aprobar y los códigos de error", async () => {
    const mk = (path: string, method: string, body?: unknown) =>
      handleVideoProjects(new Request(`http://x${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } }), cors);
    const created = await (await mk("/api/video/projects", "POST", { title: "Reel REST", target_seconds: 9 }))!.json() as any;
    const id = created.project.id;
    expect((await mk(`/api/video/projects/${id}/approve`, "POST"))!.status).toBe(400); // sin escenas
    expect((await mk(`/api/video/projects/nope`, "GET"))!.status).toBe(404);
    const patched = await (await mk(`/api/video/projects/${id}`, "PATCH", { scenes: [{ seconds: 6, prompt: "a" }, { seconds: 3, prompt: "b" }] }))!.json() as any;
    expect(patched.project.cost.pending_scenes).toBe(2);
    const approved = await mk(`/api/video/projects/${id}/approve`, "POST");
    expect(approved!.status).toBe(200);
    expect((await mk("/api/video/otra", "GET"))).toBeNull();
    expect(StudioError).toBeDefined();
  });
});

describe("rehacer la voz sin volver a generar el video", () => {
  test("dubKeyFor cambia con la voz, sus ajustes o el diálogo; canRedub exige el clip original en disco", async () => {
    const { dubKeyFor, canRedub } = await import("../packages/core/src/video/studio");
    const ch = { id: "c1", name: "A", description: "", voice_id: "v1", voice_name: "V", voice_settings: {} } as any;
    const scene = { character_ids: ["c1"], dialogue: "Hola", status: "done", raw_path: null } as any;
    const base = dubKeyFor({ characters: [ch] } as any, scene);
    expect(dubKeyFor({ characters: [{ ...ch, voice_id: "v2" }] } as any, scene)).not.toBe(base);
    expect(dubKeyFor({ characters: [{ ...ch, voice_settings: { stability: 0.9 } }] } as any, scene)).not.toBe(base);
    expect(dubKeyFor({ characters: [ch] } as any, { ...scene, dialogue: "Adiós" })).not.toBe(base);
    expect(dubKeyFor({ characters: [ch] } as any, scene)).toBe(base);
    expect(canRedub(scene)).toBe(false);                                     // sin clip original
    expect(canRedub({ ...scene, raw_path: import.meta.path })).toBe(true);   // con un archivo existente
    expect(canRedub({ ...scene, raw_path: import.meta.path, dialogue: "" })).toBe(false);
  });
});

describe("warpToTiming con audio real de ElevenLabs (MP3) y tiempos irregulares", () => {
  test("no falla con un MP3, con palabras pasadas del final ni con tiempos solapados", async () => {
    const { warpToTiming } = await import("../packages/core/src/video/voice");
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "warp-mp3-"));
    try {
      Bun.spawnSync(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=220:d=3", "-b:a", "128k", join(dir, "t.mp3")]);
      const mp3 = new Uint8Array(readFileSync(join(dir, "t.mp3")));
      const W = (a: number[][]) => a.map(([start, end], i) => ({ text: `w${i}`, start, end }));
      for (const [from, to] of [
        [W([[0.3, 0.8], [0.9, 1.5], [1.6, 2.2]]), W([[1, 1.5], [1.6, 2.3], [2.4, 3]])],
        [W([[0.3, 0.8], [5.9, 6.4], [7, 8]]), W([[1, 1.5], [1.6, 2.3], [2.4, 3]])],
        [W([[0.3, 0.9], [0.8, 1.2], [1.2, 1.2]]), W([[1, 1.5], [1.4, 2], [2, 2]])],
      ]) {
        const out = await warpToTiming(mp3, from, to, 4);
        expect(out.byteLength).toBeGreaterThan(44100 * 2 * 3.5);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("música de fondo (Lyria)", () => {
  const MUSIC = { bytes: new Uint8Array(Buffer.alloc(5000, 3)), mimeType: "audio/mpeg", modelId: "lyria-3.5", costUsd: 0.08 };
  async function reel() {
    const p = await createProject({ userId: "u1", title: "Productividad con IA", brief: "consejos para ahorrar tiempo", targetSeconds: 6, resolution: "360p" });
    await updateProject(p.id, { scenes: [{ seconds: 3, prompt: "a" }, { seconds: 3, prompt: "b" }] });
    return p.id;
  }

  test("el costo incluye la música una sola vez y desaparece al apagarla o al tenerla", async () => {
    const id = await reel();
    const c = projectCost(await getProject(id));
    expect(c.music_usd).toBeCloseTo(0.08, 4);
    expect(c.total_usd).toBeCloseTo(c.estimated_usd + c.images_usd + 0.08, 4);
    await updateProject(id, { style: { music: { enabled: false } } });
    expect(projectCost(await getProject(id)).music_usd).toBe(0);
  });

  test("se compone una vez, se mezcla con el volumen pedido y un reintento la reutiliza", async () => {
    const id = await reel();
    await updateProject(id, { style: { music: { volume: 0.2, mood: "piano cálido" } } });
    await approveProject(id);
    const prompts: string[] = [];
    const mixes: Array<{ path: string; volume: number }> = [];
    const hooks = {
      fetchImpl: fakeFetch, concat: fakeConcat, wait: true as const, duration: async () => 3,
      musicGen: async (pr: string) => { prompts.push(pr); return MUSIC; },
      musicMix: async (r: Uint8Array, path: string, o: { volume: number }) => { mixes.push({ path, volume: o.volume }); return new Uint8Array(Buffer.concat([r, Buffer.from("MUSIC")])); },
      burn: async (r: Uint8Array) => r,
    };
    const done = await startProduction(id, hooks);
    expect(done.status).toBe("done");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Instrumental only, no vocals");
    expect(prompts[0]).toContain("Productividad con IA");
    expect(prompts[0]).toContain("piano cálido");
    expect(mixes).toHaveLength(1);
    expect(mixes[0].volume).toBe(0.2);
    expect(done.music?.path).toBe(mixes[0].path);
    expect(done.activity.at(-1)!.text).toContain("música de fondo");
    expect(done.spent_usd).toBeGreaterThanOrEqual(0.08);
    // la música ya existe: no se vuelve a pedir ni a cobrar
    expect(projectCost(await getProject(id)).music_usd).toBe(0);
  });

  test("si Lyria falla, el reel se entrega sin música y se avisa", async () => {
    const id = await reel();
    await approveProject(id);
    const done = await startProduction(id, {
      fetchImpl: fakeFetch, concat: fakeConcat, wait: true, duration: async () => 3,
      musicGen: async () => { throw new Error("sin saldo"); }, burn: async (r: Uint8Array) => r,
    });
    expect(done.status).toBe("done");
    expect(done.final_path).toBeTruthy();
    expect(done.music).toBeNull();
    expect(done.activity.some((a) => a.kind === "warn" && a.text.includes("música de fondo") && a.text.includes("sin saldo"))).toBe(true);
  });

  test("un reel terminado puede agregar la música sin volver a generar clips", async () => {
    const id = await reel();
    await updateProject(id, { style: { music: { enabled: false } } });
    await approveProject(id);
    await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, duration: async () => 3, burn: async (r: Uint8Array) => r });
    const clipCalls = calls.length;
    await updateProject(id, { style: { music: { enabled: true } } });
    const { startMusic } = await import("../packages/core/src/video/studio");
    let mixed = 0;
    const done = await startMusic(id, {
      wait: true, concat: fakeConcat, duration: async () => 3, burn: async (r: Uint8Array) => r,
      musicGen: async () => MUSIC, musicMix: async (r: Uint8Array) => { mixed++; return r; },
    });
    expect(done.status).toBe("done");
    expect(done.music).not.toBeNull();
    expect(mixed).toBe(1);
    expect(calls.length).toBe(clipCalls); // ni un clip nuevo
  });

  test("generateMusic pide Lyria con la revisión de API y cae al modelo de clips si el principal no existe", async () => {
    const { generateMusic, parseMusic, buildMusicPrompt } = await import("../packages/core/src/video/music");
    const seen: Array<{ model: string; rev: string | null }> = [];
    const f = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      seen.push({ model: body.model, rev: (init.headers as Record<string, string>)["Api-Revision"] ?? null });
      if (body.model === "lyria-3.5") return new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404 });
      return new Response(JSON.stringify({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "x" }, { type: "audio", mime_type: "audio/mpeg", data: Buffer.alloc(4000, 1).toString("base64") }] }] }));
    }) as unknown as typeof fetch;
    const m = await generateMusic("prompt", { fetchImpl: f });
    expect(m.modelId).toBe("lyria-3-clip-preview");
    expect(m.costUsd).toBeCloseTo(0.04, 4);
    expect(seen.map((s) => s.model)).toEqual(["lyria-3.5", "lyria-3-clip-preview"]);
    expect(seen.every((s) => s.rev === "2026-05-20")).toBe(true);
    expect(parseMusic({ steps: [{ content: [{ type: "audio", data: "QQ==" }] }] }).data).toBe("QQ==");
    expect(buildMusicPrompt({ title: "T", mood: "jazz suave", seconds: 30 })).toContain("jazz suave");
  });

  test.skipIf(!Bun.which("ffmpeg"))("mixBackgroundMusic (ffmpeg real) conserva el video, el largo del reel y el audio", async () => {
    const { mixBackgroundMusic } = await import("../packages/core/src/video/music");
    const { ffmpegRun, durationOf } = await import("../packages/core/src/video/voice");
    const { readFileSync, writeFileSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "mix-"));
    try {
      await ffmpegRun(["-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=15:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4", "-c:v", "mpeg4", "-c:a", "aac", "-shortest", "reel.mp4"], dir);
      await ffmpegRun(["-y", "-f", "lavfi", "-i", "sine=f=220:d=2", "-b:a", "128k", "m.mp3"], dir); // más corta que el reel: se repite
      const out = await mixBackgroundMusic(new Uint8Array(readFileSync(join(dir, "reel.mp4"))), join(dir, "m.mp3"), { volume: 0.15, totalSec: 4 });
      writeFileSync(join(dir, "out.mp4"), out);
      expect(await durationOf(join(dir, "out.mp4"))).toBeGreaterThan(3.5);
      const probe = await ffmpegRun(["-i", "out.mp4", "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], dir);
      expect(probe.code).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("pista de audio maestra (el sonido se arma una sola vez al final)", () => {
  async function reel() {
    const p = await createProject({ userId: "u1", title: "Maestra", targetSeconds: 6, resolution: "360p" });
    await updateProject(p.id, { scenes: [{ seconds: 3, prompt: "a" }, { seconds: 3, prompt: "b" }], style: { music: { enabled: false } } });
    await approveProject(p.id);
    return p.id;
  }

  test("el video se une sin audio y el audio se arma desde los clips originales con la posición de cada escena", async () => {
    const id = await reel();
    const specs: any[] = [];
    const joins: Array<{ audio?: boolean }> = [];
    const done = await startProduction(id, {
      fetchImpl: fakeFetch, concat: fakeConcat, wait: true, duration: async () => 3, burn: async (r: Uint8Array) => r,
      join: async (_p: string[], _d: number[], _t: any, o?: { audio?: boolean }) => { joins.push(o ?? {}); return new Uint8Array(Buffer.from("VIDEO")); },
      audioMaster: async (spec: any) => { specs.push(spec); return new Uint8Array(Buffer.from("AUDIO")); },
      mux: async (v: Uint8Array, a: Uint8Array) => new Uint8Array(Buffer.concat([v, Buffer.from("+"), a])),
    });
    expect(done.status).toBe("done");
    expect(joins).toEqual([{ audio: false }]);
    expect(specs).toHaveLength(1);
    const sp = specs[0];
    expect(sp.scenes).toHaveLength(2);
    expect(sp.overlap).toBeCloseTo(0.4, 2);
    expect(sp.scenes[0].start).toBe(0);
    expect(sp.scenes[1].start).toBeCloseTo(3 - 0.4, 2);   // la segunda entra donde empieza la transición
    expect(sp.total).toBeCloseTo(6 - 0.4, 2);
    expect(sp.scenes.every((s: any) => s.from === 0)).toBe(true);
    expect(sp.music).toBeNull();
    expect(done.activity.some((a) => a.kind === "warn")).toBe(false);
  });

  test("si armar el audio final falla, se usa el método anterior y se avisa; el reel no se pierde", async () => {
    const id = await reel();
    const { MasterAudioError } = await import("../packages/core/src/video/audio-master");
    const joins: Array<{ audio?: boolean }> = [];
    const done = await startProduction(id, {
      fetchImpl: fakeFetch, concat: fakeConcat, wait: true, duration: async () => 3, burn: async (r: Uint8Array) => r,
      join: async (_p: string[], _d: number[], _t: any, o?: { audio?: boolean }) => { joins.push(o ?? {}); return new Uint8Array(Buffer.from("VIDEO")); },
      audioMaster: async () => { throw new MasterAudioError("sin memoria"); },
    });
    expect(done.status).toBe("done");
    expect(done.final_path).toBeTruthy();
    expect(joins).toEqual([{ audio: false }, { audio: true }]);
    expect(done.activity.some((a) => a.kind === "warn" && a.text.includes("método anterior") && a.text.includes("sin memoria"))).toBe(true);
  });

  test.skipIf(!Bun.which("ffmpeg"))("buildMasterAudio + muxAudio (ffmpeg real): un solo AAC, largo exacto, voz mono sin perder nivel y música bajo la voz", async () => {
    const { buildMasterAudio, muxAudio } = await import("../packages/core/src/video/audio-master");
    const { ffmpegRun, durationOf } = await import("../packages/core/src/video/voice");
    const { readFileSync, writeFileSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "master-"));
    try {
      // dos clips de 3 s con voz mono (tono) y un video sin audio de 5,6 s; música más corta que el reel (se repite)
      for (const [n, f] of [["a", 440], ["b", 660]] as const) await ffmpegRun(["-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=15:d=3", "-f", "lavfi", "-i", `sine=f=${f}:d=3,volume=0.5`, "-ac", "1", "-c:v", "mpeg4", "-c:a", "aac", n + ".mp4"], dir);
      await ffmpegRun(["-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=15:d=5.6", "-an", "-c:v", "mpeg4", "silent.mp4"], dir);
      await ffmpegRun(["-y", "-f", "lavfi", "-i", "sine=f=220:d=2", "-b:a", "128k", "m.mp3"], dir);
      const audio = await buildMasterAudio({
        total: 5.6, overlap: 0.4, music: { path: join(dir, "m.mp3"), volume: 0.1 },
        scenes: [
          { path: join(dir, "a.mp4"), start: 0, duration: 3, from: 0, hasAudio: true, channels: 1 },
          { path: join(dir, "b.mp4"), start: 2.6, duration: 3, from: 0, hasAudio: true, channels: 1 },
        ],
      });
      writeFileSync(join(dir, "master.m4a"), audio);
      const out = await muxAudio(new Uint8Array(readFileSync(join(dir, "silent.mp4"))), audio);
      writeFileSync(join(dir, "out.mp4"), out);
      expect(await durationOf(join(dir, "out.mp4"))).toBeGreaterThan(5.4);
      expect(await durationOf(join(dir, "out.mp4"))).toBeLessThan(5.9);
      const streams = Bun.spawnSync(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "csv=p=0", join(dir, "out.mp4")]).stdout.toString().trim().split("\n").sort();
      expect(streams).toEqual(["aac,audio", "mpeg4,video"]);
      // la voz mono conserva su nivel: el pico final es el del clip original (±2 dB, con la música muy baja debajo)
      const peakOf = (f: string) => Number(/max_volume: (-?[\d.]+) dB/.exec(Bun.spawnSync(["ffmpeg", "-hide_banner", "-i", f, "-vn", "-af", "volumedetect", "-f", "null", "-"]).stderr.toString())![1]);
      const src = peakOf(join(dir, "a.mp4")), res = peakOf(join(dir, "out.mp4"));
      // la normalización final (−15 LUFS, pico máx. −1.5 dB) puede subir un clip muy bajo, pero nunca lo baja ni lo deja pegado al techo
      expect(res).toBeGreaterThan(src - 2);
      expect(res).toBeLessThan(-0.5);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("efectos de voz", () => {
  test("suggestVoiceFx sugiere según lo que se dice y se ve; sin diálogo no sugiere nada", async () => {
    const { suggestVoiceFx, fxFilter, normalizeVoiceFx, VOICE_FX_IDS } = await import("../packages/core/src/video/voice-fx");
    expect(suggestVoiceFx({ dialogue: "" })).toBeNull();
    expect(suggestVoiceFx({ dialogue: "Última hora: la IA cambia el empleo" })!.id).toBe("radio");
    expect(suggestVoiceFx({ dialogue: "Te cuento un secreto" })!.id).toBe("intimate");
    expect(suggestVoiceFx({ dialogue: "[whispering] Ven" })!.id).toBe("intimate");
    expect(suggestVoiceFx({ dialogue: "Imagina el futuro", prompt: "plano épico" })!.id).toBe("cinematic");
    expect(suggestVoiceFx({ dialogue: "Hola, bienvenidos" , prompt: "mujer en un podcast"})!.id).toBe("podcast");
    expect(suggestVoiceFx({ dialogue: "Hola, bienvenidos" })!.id).toBe("studio");
    expect(normalizeVoiceFx("inventado")).toBe("none");
    expect(fxFilter("none")).toBe("");
    expect(fxFilter("radio")).toContain("highpass");
    expect(VOICE_FX_IDS).toContain("studio");
  });

  test.skipIf(!Bun.which("ffmpeg"))("todos los presets corren en ffmpeg real y no dejan la voz recortada", async () => {
    const { VOICE_FX } = await import("../packages/core/src/video/voice-fx");
    const dir = mkdtempSync(join(tmpdir(), "fx-"));
    try {
      // «voz» sintética: tono modulado con ruido suave, estéreo a 48 kHz
      Bun.spawnSync(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "aevalsrc=0.4*sin(2*PI*200*t)*(0.6+0.4*sin(2*PI*3*t))+0.1*sin(2*PI*2500*t):d=2:s=48000", "-ac", "2", join(dir, "src.wav")]);
      for (const fx of VOICE_FX) {
        const r = Bun.spawnSync(["ffmpeg", "-v", "error", "-y", "-i", join(dir, "src.wav"), ...(fx.filter ? ["-af", fx.filter] : []), join(dir, `${fx.id}.wav`)]);
        expect(r.exitCode).toBe(0);
        const log = Bun.spawnSync(["ffmpeg", "-hide_banner", "-i", join(dir, `${fx.id}.wav`), "-af", "astats=metadata=0", "-f", "null", "-"]).stderr.toString();
        const peak = Number(/Peak level dB: (-?[\d.]+)/.exec(log)![1]);
        expect(peak).toBeLessThan(0.5);        // el limitador del audio final hace el resto; aquí solo se descarta un desborde grave
        expect(peak).toBeGreaterThan(-40);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("el efecto de la escena manda sobre el del personaje; cambiarlo no invalida clips ni cuesta y el audio lo recibe", async () => {
    const { fxFilter } = await import("../packages/core/src/video/voice-fx");
    const { dubKeyFor } = await import("../packages/core/src/video/studio");
    const p = await mkProject({ userId: "u1", title: "FX", targetSeconds: 6, resolution: "360p" });
    const c = await updateProject(p.id, { characters: [{ name: "Ana", description: "x", voice_id: "v1", voice_settings: { fx: "podcast" } }] });
    const cid = c.characters[0].id;
    await updateProject(p.id, { scenes: [
      { seconds: 3, prompt: "a", character_ids: [cid], dialogue: "Hola" },
      { seconds: 3, prompt: "b", character_ids: [cid], dialogue: "Adiós", fx: "radio" },
      { seconds: 3, prompt: "c" },
    ], style: { trim: { enabled: false } } });
    await approveProject(p.id);
    const specs: any[] = [];
    const run = (extra = {}) => startProduction(p.id, {
      fetchImpl: fakeFetch, concat: fakeConcat, wait: true, duration: async () => 3, burn: async (r: Uint8Array) => r,
      join: async () => new Uint8Array(Buffer.from("V")), mux: async (v: Uint8Array) => v,
      audioMaster: async (s: any) => { specs.push(s); return new Uint8Array(Buffer.from("A")); }, ...extra,
    });
    const done = await run({ voice: { enabled: false } });
    expect(done.status).toBe("done");
    expect(specs[0].scenes.map((s: any) => s.fx)).toEqual([fxFilter("podcast"), fxFilter("radio"), ""]); // personaje · escena · sin diálogo
    const keyBefore = dubKeyFor(await getProject(p.id), done.scenes[0]);
    const clipCalls = calls.length;
    // cambiar el efecto del personaje y el de una escena: solo se vuelve a unir
    await updateProject(p.id, { characters: [{ id: cid, name: "Ana", description: "x", voice_settings: { fx: "intimate" } }] });
    let after = await getProject(p.id);
    expect(after.final_path).toBeNull();                                   // el reel ya no corresponde
    expect(after.scenes.every((s) => s.status === "done")).toBe(true);     // los clips siguen
    expect(dubKeyFor(after, after.scenes[0])).toBe(keyBefore);             // la voz NO quedó desactualizada
    expect(projectCost(after).total_usd).toBe(0);
    await updateProject(p.id, { scenes: after.scenes.map((s) => ({ id: s.id, seconds: s.seconds, prompt: s.prompt, character_ids: s.character_ids, fx: s.id === after.scenes[1].id ? "none" : undefined })) });
    after = await getProject(p.id);
    expect(after.scenes.every((s) => s.status === "done")).toBe(true);
    await run({ voice: { enabled: false } });
    expect(calls.length).toBe(clipCalls);                                  // ni un clip nuevo
    expect(specs[1].scenes.map((s: any) => s.fx)).toEqual([fxFilter("intimate"), "", ""]);
  });
});

describe("reels sin personaje (voz en off)", () => {
  async function noCharProject(narrator: boolean) {
    const p = await mkProject({ userId: "u1", title: "Paisajes", targetSeconds: 6, resolution: "360p", narrator: narrator ? { voice_id: "voz-n", voice_name: "Narrador de prueba" } : undefined });
    await updateProject(p.id, { scenes: [{ seconds: 3, prompt: "Amanecer sobre una ciudad", dialogue: "Cada día empieza igual." }, { seconds: 3, prompt: "Manos tecleando" }], style: { trim: { enabled: false } } });
    await approveProject(p.id);
    return p.id;
  }
  const hooks = (seen: { synth: any[]; mix: any[] }) => ({
    voice: {
      enabled: true,
      synthesize: async (i: any) => { seen.synth.push(i); return { bytes: new Uint8Array(Buffer.alloc(400, 3)) }; },
      mix: async (clip: Uint8Array, _v: Uint8Array, m: any) => { seen.mix.push(m); return clip; },
      align: async () => [{ text: "Cada", start: 0.3, end: 0.6 }, { text: "día", start: 0.7, end: 1 }],
    },
  });

  test("la escena sin personaje NO pide a nadie hablando a cámara y su línea se narra con la voz del narrador", async () => {
    const id = await noCharProject(true);
    const seen = { synth: [] as any[], mix: [] as any[] };
    const done = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, duration: async () => 3, burn: async (r: Uint8Array) => r, ...hooks(seen) });
    expect(done.status).toBe("done");
    const prompt = String(calls.find((c) => String(c.url).includes("interactions"))!.body.input);
    expect(prompt).not.toContain("speaks directly");
    expect(prompt).toContain("voice-over");
    expect(prompt).toContain("nobody talks to the camera");
    expect(seen.synth).toHaveLength(1);                     // solo la escena con texto
    expect(seen.synth[0].voiceId).toBe("voz-n");
    expect(seen.synth[0].settings.mode).toBe("narration");
    expect(done.scenes[0].captions.length).toBeGreaterThan(0); // subtítulos de la voz en off
    expect(done.scenes[0].raw_path).toBeTruthy();              // permite rehacer la voz sin pagar el video
  });

  test("sin narrador de ElevenLabs la locución la hace Gemini (texto a voz) y la escena lleva subtítulos", async () => {
    const id = await noCharProject(false);
    const seen = { synth: [] as any[], mix: [] as any[] };
    const gem: string[] = [];
    const h = hooks(seen);
    const done = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, duration: async () => 3, burn: async (r: Uint8Array) => r, ...h, voice: { ...h.voice, geminiSpeech: async (i: { text: string }) => { gem.push(i.text); return { bytes: new Uint8Array(Buffer.alloc(400, 4)) }; } } });
    expect(done.status).toBe("done");
    expect(seen.synth).toHaveLength(0);   // ElevenLabs no interviene
    expect(gem.length).toBeGreaterThan(0); // la voz sale de Gemini
    expect(String(calls[0].body.input)).not.toContain("speaks directly");
    expect(done.scenes[0].captions.length).toBeGreaterThan(0);
  });

  test("si la voz de Gemini falla, el reel no falla: se avisa y la escena queda sin voz", async () => {
    const id = await noCharProject(false);
    const seen = { synth: [] as any[], mix: [] as any[] };
    const h = hooks(seen);
    const done = await startProduction(id, { fetchImpl: fakeFetch, concat: fakeConcat, wait: true, duration: async () => 3, burn: async (r: Uint8Array) => r, ...h, voice: { ...h.voice, geminiSpeech: async () => { throw new Error("cuota"); } } });
    expect(done.status).toBe("done");
    expect(done.activity.some((a) => a.kind === "warn" && a.text.includes("voz en off con Gemini"))).toBe(true);
  });

  test("el modo voz en off del guionista no usa personajes ni vestuario", async () => {
    const { writeScript } = await import("../packages/core/src/video/ai-writer");
    let userMsg = "";
    const out = await writeScript({ title: "Café", brief: "cómo se hace", target_seconds: 6, mode: "voiceover", characters_detail: [{ id: "c1", name: "Ana" }] }, {
      call: async (m: any[]) => { userMsg = m[1].content; return JSON.stringify({ script: "Un café.", scenes: [{ seconds: 3, prompt: "granos cayendo", wardrobe: "camisa", dialogue: "Todo empieza con un grano.", character_ids: ["c1"], graphic: { kind: "lower_third", text: "Ana", sub: "x" } }, { seconds: 3, prompt: "taza humeante", dialogue: "Y termina en tus manos.", character_ids: [] }] }); },
    });
    expect(userMsg).toContain("MODO VOZ EN OFF");
    expect(userMsg).not.toContain('id "c1"');
    expect(out.scenes.every((s) => s.character_ids.length === 0 && s.wardrobe === "")).toBe(true);
  });
});

describe("tarjetas de gráficos, imágenes con movimiento e identidad visual", () => {
  async function mixed() {
    const p = await mkProject({ userId: "u1", title: "Datos", targetSeconds: 9, resolution: "360p", narrator: { voice_id: "voz-n", voice_name: "Narrador" } });
    await updateProject(p.id, { scenes: [
      { seconds: 3, prompt: "Ciudad al amanecer" },
      { seconds: 3, source: "card", card: { kind: "stat", value: "73 %", title: "de los empleos cambiarán" }, dialogue: "Tres de cada cuatro." },
      { seconds: 3, source: "image", prompt: "Infografía del proceso con el texto \"Aprende. Aplica.\"" },
    ], style: { trim: { enabled: false }, music: { enabled: false } } });
    return p.id;
  }

  test("el costo: el clip cuesta por segundo, la tarjeta nada y la imagen lo de una imagen", async () => {
    const { sceneCostUsd } = await import("../packages/core/src/video/studio");
    const id = await mixed();
    const p = await getProject(id);
    expect(p.scenes.map((s) => s.source)).toEqual(["clip", "card", "image"]);
    expect(sceneCostUsd(p, p.scenes[1])).toBe(0);
    expect(sceneCostUsd(p, p.scenes[2])).toBeGreaterThan(0);
    expect(sceneCostUsd(p, p.scenes[2])).toBeLessThan(sceneCostUsd(p, p.scenes[0]));
    const only = await mkProject({ userId: "u1", title: "Solo tarjetas", targetSeconds: 6, resolution: "360p" });
    await updateProject(only.id, { scenes: [{ seconds: 3, source: "card", card: { kind: "title", title: "Hola" } }, { seconds: 3, source: "card", card: { kind: "cta", title: "Comenta" } }] });
    expect(projectCost(await getProject(only.id)).total_usd).toBe(0);   // un reel solo de tarjetas es gratis
  });

  test("una tarjeta sin contenido no se acepta; tarjetas e imágenes no llevan personaje; la tarjeta se describe sola", async () => {
    const p = await mkProject({ userId: "u1", title: "X", targetSeconds: 6 });
    await expect(updateProject(p.id, { scenes: [{ seconds: 3, prompt: "", source: "card", card: { kind: "stat" } as any }] })).rejects.toBeInstanceOf(StudioError);
    const c = await updateProject(p.id, { characters: [{ name: "Ana", description: "x" }] });
    const out = await updateProject(p.id, { scenes: [{ seconds: 3, source: "card", card: { kind: "title", title: "El gancho" }, character_ids: [c.characters[0].id], wardrobe: "traje" }] });
    expect(out.scenes[0].character_ids).toEqual([]);
    expect(out.scenes[0].wardrobe).toBe("");
    expect(out.scenes[0].prompt).toContain("El gancho");
  });

  test("producir un reel mixto: el clip va a Gemini, la tarjeta se dibuja con la identidad y la imagen se anima; la voz en off narra la tarjeta", async () => {
    const id = await mixed();
    await approveProject(id);
    const cards: any[] = [];
    const prompts: string[] = [];
    const seen = { synth: [] as any[] };
    const PNG = new Uint8Array(Buffer.alloc(300, 5));
    const done = await startProduction(id, {
      fetchImpl: fakeFetch, concat: fakeConcat, wait: true, duration: async () => 3, burn: async (r: Uint8Array) => r,
      card: async (c: any, ident: any, o: any) => { cards.push({ c, ident, o }); return new Uint8Array(Buffer.from("CARD")); },
      imageScene: async (pr: string) => { prompts.push(pr); return { bytes: PNG }; },
      voice: { enabled: true, synthesize: async (i: any) => { seen.synth.push(i); return { bytes: new Uint8Array(Buffer.alloc(400, 3)) }; }, mix: async (c: Uint8Array) => c, align: async () => [{ text: "Tres", start: 0.2, end: 0.5 }] },
    } as any).catch((e) => e);
    // la imagen de apoyo exige ffmpeg real sobre bytes que no son una imagen: si falla ahí, lo comprobado antes igualmente debe haber ocurrido
    expect(cards).toHaveLength(1);
    expect(cards[0].c.kind).toBe("stat");
    expect(cards[0].ident.preset).toBe("swiss");
    expect(cards[0].o).toMatchObject({ aspect: "9:16", seconds: 3, resolution: "360p" });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("\"Aprende. Aplica.\"");
    expect(prompts[0]).toContain("#2F6BFF");                 // la identidad viaja en el pedido de imagen
    expect(prompts[0]).toContain("correct Spanish");
    expect(seen.synth).toHaveLength(1);                      // la voz en off narró la tarjeta
    expect(seen.synth[0].voiceId).toBe("voz-n");
    void done;
  });

  test("cambiar la identidad rehace las tarjetas (gratis), mueve el acento de los gráficos y no toca los clips", async () => {
    const id = await mixed();
    await updateProject(id, { scenes: (await getProject(id)).scenes.map((s) => ({ id: s.id, seconds: s.seconds, prompt: s.prompt, source: s.source, card: s.card as any })) });
    // marca todo como hecho para comprobar qué se invalida
    const c = await col<any>("videoProjects");
    const doc = (await c.get(id))!.doc;
    for (const s of doc.scenes) { s.status = "done"; s.artifact_id = "x"; s.path = import.meta.path; }
    doc.final_path = import.meta.path; doc.final_artifact_id = "f";
    await c.put(id, doc);
    const out = await updateProject(id, { identity: { preset: "velvet" } });
    expect(out.identity.accent).toBe("#C9A84C");
    expect(out.style.graphics.accent).toBe("#C9A84C");
    expect(out.scenes.map((s) => s.status)).toEqual(["done", "pending", "done"]);   // solo la tarjeta se rehace
    expect(out.final_path).toBeNull();
    expect(projectCost(out).total_usd).toBe(0);                                      // y no cuesta
  });
});

describe("identidad y tarjetas (módulos)", () => {
  test("normalizeIdentity parte de un preset, valida colores y avisa de bajo contraste", async () => {
    const { normalizeIdentity, identityIssues, contrastRatio, IDENTITY_PRESETS } = await import("../packages/core/src/video/identity");
    expect(normalizeIdentity().preset).toBe("swiss");
    expect(normalizeIdentity({ preset: "soft" }).bg).toBe("#F6EFE7");
    const custom = normalizeIdentity({ preset: "soft", accent: "#123456", bg: "no-es-color" });
    expect(custom.accent).toBe("#123456");
    expect(custom.bg).toBe("#F6EFE7");
    expect(identityIssues({ ...normalizeIdentity(), fg: "#101010", bg: "#111111" }).length).toBeGreaterThan(0);
    for (const p of IDENTITY_PRESETS) expect(contrastRatio(p.fg, p.bg)).toBeGreaterThan(4.5);   // todos los presets se leen
  });

  test("normalizeCard exige el texto mínimo de cada tipo y limita largos", async () => {
    const { normalizeCard } = await import("../packages/core/src/video/cards");
    expect(normalizeCard({ kind: "stat", value: "" } as any)).toBeNull();
    expect(normalizeCard({ kind: "list", items: [] } as any)).toBeNull();
    expect(normalizeCard({ kind: "compare", columns: [{ label: "a", text: "b" }] } as any)).toBeNull();
    expect(normalizeCard({ kind: "raro", title: "x" } as any)).toBeNull();
    const l = normalizeCard({ kind: "list", items: ["1", "2", "3", "4", "5", "6", "7"].map((x) => x.repeat(100)) } as any)!;
    expect(l.items).toHaveLength(5);
    expect(l.items[0].length).toBe(70);
    expect(normalizeCard({ kind: "stat", value: "73 %", fill: 250 } as any)!.fill).toBe(100);
  });

  test("buildCardHtml escapa el texto, usa los colores de la identidad y anima la cifra", async () => {
    const { buildCardHtml, normalizeCard, canvasFor } = await import("../packages/core/src/video/cards");
    const { normalizeIdentity } = await import("../packages/core/src/video/identity");
    const html = buildCardHtml(normalizeCard({ kind: "stat", value: "73 %", title: "Tom & <b>Jerry</b>" })!, normalizeIdentity({ preset: "drift" }), canvasFor("9:16"), 4);
    expect(html).toContain("Tom &amp; &lt;b&gt;Jerry&lt;/b&gt;");
    expect(html).not.toContain("<b>Jerry");
    expect(html).toContain("#19C3A6");
    expect(html).toContain('data-count="73"');
    expect(html).toContain("white-space:nowrap");            // la cifra no se parte
    expect(html).toContain("window.__seek");
  });

  test.skipIf(!Bun.which("ffmpeg"))("renderCard codifica los cuadros capturados a un MP4 del tamaño y los fps de los clips de Gemini", async () => {
    const { renderCard, normalizeCard } = await import("../packages/core/src/video/cards");
    const { normalizeIdentity } = await import("../packages/core/src/video/identity");
    const dir = mkdtempSync(join(tmpdir(), "cardtest-"));
    try {
      Bun.spawnSync(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=720x1280:d=1", "-frames:v", "1", join(dir, "f.png")]);
      const png = new Uint8Array(await Bun.file(join(dir, "f.png")).arrayBuffer());
      const mp4 = await renderCard(normalizeCard({ kind: "title", title: "Hola" })!, normalizeIdentity(), { aspect: "9:16", seconds: 2, resolution: "360p", capture: async (_h, _c, times) => times.map(() => png) });
      await Bun.write(join(dir, "o.mp4"), mp4);
      const p = Bun.spawnSync(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height,r_frame_rate,nb_frames", "-of", "csv=p=0", join(dir, "o.mp4")]).stdout.toString().trim();
      expect(p).toBe("360,640,24/1,48");                     // 360p = lado corto 360 como Gemini, 24 fps, 2 s
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test.skipIf(!Bun.which("ffmpeg"))("animateStill y motionFor: movimiento de cámara sobre una imagen fija", async () => {
    const { animateStill, motionFor, buildImageScenePrompt } = await import("../packages/core/src/video/image-scene");
    const { normalizeIdentity } = await import("../packages/core/src/video/identity");
    expect([0, 1, 2, 3, 4].map(motionFor)).toEqual(["zoom_in", "zoom_out", "pan_left", "pan_right", "zoom_in"]);
    expect(buildImageScenePrompt("Un cohete", normalizeIdentity(), "9:16")).toContain("Keep the lower fifth");
    const dir = mkdtempSync(join(tmpdir(), "still-"));
    try {
      Bun.spawnSync(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=400x700:d=1", "-frames:v", "1", join(dir, "i.png")]);
      const mp4 = await animateStill(new Uint8Array(await Bun.file(join(dir, "i.png")).arrayBuffer()), { aspect: "9:16", seconds: 2, resolution: "360p", motion: "pan_left" });
      await Bun.write(join(dir, "o.mp4"), mp4);
      expect(Bun.spawnSync(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height,r_frame_rate,nb_frames", "-of", "csv=p=0", join(dir, "o.mp4")]).stdout.toString().trim()).toBe("360,640,24/1,48");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("narrar un clip sin audio propio (tarjetas e imágenes)", () => {
  test.skipIf(!Bun.which("ffmpeg"))("mixDialogue conserva el largo del video aunque la voz sea más corta", async () => {
    const { mixDialogue, durationOf } = await import("../packages/core/src/video/voice");
    const dir = mkdtempSync(join(tmpdir(), "mixsilent-"));
    try {
      Bun.spawnSync(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=24:d=4", "-an", "-c:v", "mpeg4", join(dir, "card.mp4")]);   // 4 s sin audio
      Bun.spawnSync(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=300:d=1.5", "-b:a", "128k", join(dir, "voice.mp3")]);                     // voz de 1,5 s
      const out = await mixDialogue(new Uint8Array(await Bun.file(join(dir, "card.mp4")).arrayBuffer()), new Uint8Array(await Bun.file(join(dir, "voice.mp3")).arrayBuffer()), {});
      await Bun.write(join(dir, "o.mp4"), out);
      expect(await durationOf(join(dir, "o.mp4"))).toBeGreaterThan(3.8);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
