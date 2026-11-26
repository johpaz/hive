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
  const p = await createProject({ userId: "u1", title: "Gato astronauta", brief: "reel", targetSeconds: 8, resolution: "360p" });
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
    const p = await createProject({ userId: "u1", title: "vacío" });
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
    const p = await createProject({ userId: "u1", title: "Mi reel", targetSeconds: 6, resolution: "360p" });
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
    const p = await createProject({ userId: "u1", title: "Volumen", targetSeconds: 3, resolution: "360p" });
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
    const p = await createProject({ userId: "u1", title: "Ajustes", targetSeconds: 3, resolution: "360p" });
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
    expect(status.voice_defaults).toMatchObject({ model_id: "eleven_v4", stability: 0.5 });
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
    const p = await createProject({ userId: "u1", title: "Con voz", targetSeconds: 6, resolution: "360p" });
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
    const p = await createProject({ userId: "u1", title: "Sin voz", targetSeconds: 3, resolution: "360p" });
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
      expect(ends[0]).toBeCloseTo(0.5, 1); expect(ends[1]).toBeCloseTo(1.3, 1); expect(ends[2]).toBeCloseTo(2.2, 1);
      expect(starts[1]).toBeCloseTo(0.9, 1); expect(starts[2]).toBeCloseTo(1.9, 1); expect(starts[3]).toBeCloseTo(2.5, 1);
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
    };
  };

  async function talkingProject(opts: { voice?: boolean; mode?: "sync" | "convert" | "narration" } = { voice: true }) {
    const p = await createProject({ userId: "u1", title: "Habla", targetSeconds: 6, resolution: "360p" });
    const c = await updateProject(p.id, { characters: [{ name: "Ana", description: "presentadora", ...(opts.voice ? { voice_id: "voz-ana", voice_name: "Ana clonada", voice_settings: { volume: 1.4, stability: 1, ...(opts.mode ? { mode: opts.mode } : {}) } } : {}) }] });
    const cid = c.characters[0].id;
    await updateProject(p.id, { scenes: [
      { seconds: 3, prompt: "Ana saluda", character_ids: [cid], dialogue: "[whispering] Hola mundo" },
      { seconds: 3, prompt: "Ana se despide", character_ids: [cid], dialogue: "Hola mundo" },
    ] });
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
