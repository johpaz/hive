process.env.HIVE_DB_PATH = ":memory:";

import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { deleteProviderApiKey } from "../packages/core/src/storage/crypto";
import { createArtifact } from "../packages/core/src/artifacts/store";
import { generateImage, ImageGenerationError } from "../packages/core/src/multimodal/image-generation";
import {
  VideoGenerationError, clampClipSeconds, estimateClipCostUsd, generateVideoClip, splitDuration,
} from "../packages/core/src/multimodal/video-generation";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
const MP4 = Buffer.concat([Buffer.from("AAAAGGZ0eXBtcDQy", "base64"), Buffer.alloc(2000, 1)]);
const realSecrets = (Bun as any).secrets;
const prevKey = process.env.GEMINI_API_KEY;

let calls: Array<{ url: string; body: any; key: string | null }>;
let respond: (n: number) => Response;
const fakeFetch = (async (url: string, init: RequestInit) => {
  calls.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : null, key: new Headers(init.headers).get("x-goog-api-key") });
  return respond(calls.length);
}) as unknown as typeof fetch;

beforeEach(async () => {
  (Bun as any).secrets = { get: async () => null, set: async () => {}, delete: async () => false };
  closeHiveDb();
  await ensureHiveDb();
  await deleteProviderApiKey("gemini");
  process.env.GEMINI_API_KEY = "gem-test-key";
  calls = [];
});
afterEach(() => {
  (Bun as any).secrets = realSecrets;
  if (prevKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prevKey;
});

const imageOk = () => new Response(JSON.stringify({
  candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: JPEG.toString("base64") } }] } }],
}));
const videoOk = (tokens = 5793) => new Response(JSON.stringify({
  id: "v1_abc", status: "completed", usage: { total_input_tokens: 13, total_output_tokens: tokens },
  steps: [{ type: "thought" }, { type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: MP4.toString("base64") }] }],
}));

describe("Nano Banana (adaptador Gemini)", () => {
  test("pide IMAGE, la relación 9:16 y las referencias", async () => {
    respond = imageOk;
    const out = await generateImage(
      { prompt: "gato astronauta", aspectRatio: "portrait", modelId: "gemini-3.1-flash-image", referenceImages: [{ bytes: JPEG, mimeType: "image/jpeg" }] },
      { fetchImpl: fakeFetch },
    );
    expect(out.mimeType).toBe("image/jpeg");
    expect(out.providerId).toBe("gemini");
    expect(calls[0].url).toContain("/models/gemini-3.1-flash-image:generateContent");
    expect(calls[0].key).toBe("gem-test-key");
    expect(calls[0].body.generationConfig.responseModalities).toEqual(["IMAGE"]);
    expect(calls[0].body.generationConfig.imageConfig.aspectRatio).toBe("9:16");
    expect(calls[0].body.contents[0].parts[0].inlineData.mimeType).toBe("image/jpeg");
    expect(calls[0].body.contents[0].parts.at(-1).text).toBe("gato astronauta");
  });

  test("traduce 429 de capa gratuita y 402 sin saldo", async () => {
    respond = () => new Response(JSON.stringify({ error: { message: "Quota exceeded ... generate_content_free_tier_requests, limit: 0" } }), { status: 429 });
    await expect(generateImage({ prompt: "x", modelId: "gemini-3.1-flash-image" }, { fetchImpl: fakeFetch })).rejects.toThrow(/capa gratuita.*facturación/);
    expect(calls).toHaveLength(1); // no reintenta: no se arregla esperando
    respond = () => new Response(JSON.stringify({ error: { message: "Your prepayment credits are depleted." } }), { status: 402 });
    const e = await generateImage({ prompt: "x", modelId: "gemini-3.1-flash-image" }, { fetchImpl: fakeFetch }).catch((x) => x);
    expect(e).toBeInstanceOf(ImageGenerationError);
    expect(e.message).toMatch(/saldo prepagado/);
  });
});

describe("video (Omni)", () => {
  test("arma la solicitud y calcula el costo con los tokens reales", async () => {
    respond = () => videoOk();
    const v = await generateVideoClip({ prompt: "una canica rueda", aspectRatio: "9:16", durationSeconds: 3, resolution: "360p" }, { fetchImpl: fakeFetch });
    expect(calls[0].url).toEndWith("/v1beta/interactions");
    expect(calls[0].body.model).toBe("gemini-omni-1.2-flash");
    expect(calls[0].body.input).toBe("una canica rueda");
    expect(calls[0].body.response_format).toEqual({ type: "video", aspect_ratio: "9:16", resolution: "360p", duration: "3s" });
    expect(v.bytes.byteLength).toBe(MP4.byteLength);
    expect(v.interactionId).toBe("v1_abc");
    expect(v.costUsd).toBeCloseTo(0.0695, 3);
  });

  test("con referencias manda input como lista; dos fotogramas limitan a 10 s", async () => {
    respond = () => videoOk();
    const ref = { bytes: JPEG, mimeType: "image/jpeg" };
    await generateVideoClip({ prompt: "saluda", durationSeconds: 15, referenceImages: [ref, ref] }, { fetchImpl: fakeFetch });
    expect(calls[0].body.input[0].type).toBe("image");
    expect(calls[0].body.input.at(-1)).toEqual({ type: "text", text: "saluda" });
    expect(calls[0].body.response_format.duration).toBe("10s");
  });

  test("errores: sin saldo, sin video y sin clave", async () => {
    respond = () => new Response(JSON.stringify([{ error: { message: "prepayment credits are depleted" } }]), { status: 402 });
    await expect(generateVideoClip({ prompt: "x" }, { fetchImpl: fakeFetch })).rejects.toThrow(/saldo prepagado/);
    respond = () => new Response(JSON.stringify({ status: "completed", steps: [] }));
    await expect(generateVideoClip({ prompt: "x" }, { fetchImpl: fakeFetch })).rejects.toThrow(/no devolvió ningún video/);
    await expect(generateVideoClip({ prompt: "  " }, { fetchImpl: fakeFetch })).rejects.toBeInstanceOf(VideoGenerationError);
    delete process.env.GEMINI_API_KEY;
    await expect(generateVideoClip({ prompt: "x" }, { fetchImpl: fakeFetch })).rejects.toThrow(/API key/);
  });

  test("duración y costo", () => {
    expect(clampClipSeconds(1)).toBe(3);
    expect(clampClipSeconds(99)).toBe(15);
    expect(estimateClipCostUsd("720p", 10)).toBeCloseTo(0.7, 4);
    expect(splitDuration(40)).toEqual([15, 15, 10]);
    expect(splitDuration(16)).toEqual([13, 3]);
    expect(splitDuration(30).reduce((a, b) => a + b, 0)).toBe(30);
    for (const total of [3, 4, 17, 31, 59, 60]) {
      const clips = splitDuration(total);
      expect(clips.reduce((a, b) => a + b, 0)).toBe(total < 3 ? 3 : total);
      expect(clips.every((c) => c >= 3 && c <= 15)).toBe(true);
    }
  });
});

describe("carpeta del estudio", () => {
  test("estudio-videos/imagenes y estudio-videos/videos dentro del workspace del agente", async () => {
    const ws = mkdtempSync(join(tmpdir(), "hive-studio-"));
    try {
      const img = await createArtifact({ bytes: JPEG, mimeType: "image/jpeg", kind: "generated_image", userId: "u", expiresAt: null,
        visible: { workspace: ws, folder: "estudio-videos/imagenes", label: "gato astronauta" } });
      const vid = await createArtifact({ bytes: MP4, mimeType: "video/mp4", kind: "generated_video", userId: "u", expiresAt: null,
        visible: { workspace: ws, folder: "estudio-videos/videos", label: "reel gato" } });
      expect(img.path.startsWith(join(ws, "estudio-videos", "imagenes"))).toBe(true);
      expect(img.path).toEndWith(".jpg");
      expect(vid.path.startsWith(join(ws, "estudio-videos", "videos"))).toBe(true);
      expect(vid.path).toEndWith(".mp4");
      expect(existsSync(vid.path)).toBe(true);
      // no se escapa del workspace
      const evil = await createArtifact({ bytes: JPEG, mimeType: "image/jpeg", kind: "x", userId: "u", expiresAt: null,
        visible: { workspace: ws, folder: "../../etc", label: "x" } });
      expect(evil.path.startsWith(ws)).toBe(true);
    } finally { rmSync(ws, { recursive: true, force: true }); }
  });
});
