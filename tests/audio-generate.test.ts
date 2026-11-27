process.env.HIVE_DB_PATH = ":memory:";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const llamadas: Array<{ text: string; modelo: string; voz?: string }> = [];
// 0,3 s de silencio PCM 16 kHz mono como WAV mínimo válido.
function wav(): Buffer {
  const n = 4800, h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + n * 2, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(n * 2, 40);
  return Buffer.concat([h, Buffer.alloc(n * 2)]);
}
mock.module("../packages/core/src/voice/index", () => ({
  voiceService: { speak: async (text: string, modelo: string, voz?: string) => { llamadas.push({ text, modelo, voz }); return { type: "buffer", data: wav(), mimeType: "audio/wav" }; } },
  cleanTextForTTS: (t: string) => t,
}));
mock.module("../packages/core/src/gateway/tts/kitten", () => ({
  getLocalTTSStatus: () => ({ running: true, phase: "ready" }),
  getLocalVoices: () => [{ id: "lucia", name: "Lucía" }, { id: "marcos", name: "Marcos" }],
  startLocalTTS: () => true,
}));

import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { audioGenerateTool, trocear } from "../packages/core/src/tools/audio/audio-generate";

beforeEach(async () => { llamadas.length = 0; closeHiveDb(); await ensureHiveDb(); });
afterEach(() => closeHiveDb());

describe("audio_generate", () => {
  test("trocear respeta frases y el máximo", () => {
    const t = trocear("Hola a todos. ".repeat(60), 100);
    expect(t.length).toBeGreaterThan(5);
    expect(t.every((x) => x.length <= 100)).toBe(true);
    expect(trocear("x".repeat(900), 350).every((x) => x.length <= 350)).toBe(true);
  });

  test("dos locutores: voces por turno, trozos y un MP3 unido", async () => {
    const r: any = await audioGenerateTool.execute(
      { turnos: [{ texto: "Hola, soy Ana. Bienvenidos al episodio.", voz: "lucia" }, { texto: "Y yo soy Luis. Hoy hablamos de abejas.", voz: "marcos" }], titulo: "Ep 1" },
      { configurable: { user_id: "u1", workspace: null } },
    );
    expect(r.ok).toBe(true);
    expect(llamadas.map((l) => l.voz)).toEqual(["lucia", "marcos"]);
    expect(existsSync(r.ruta)).toBe(true);
    const head = readFileSync(r.ruta).subarray(0, 3).toString("latin1");
    expect(head === "ID3" || readFileSync(r.ruta)[0] === 0xff).toBe(true);
  });

  test("voz local desconocida se rechaza con la lista", async () => {
    const r: any = await audioGenerateTool.execute({ texto: "hola", voz: "zzz" }, { configurable: { user_id: "u1" } });
    expect(r.ok).toBe(false); expect(r.error).toContain("lucia");
  });

  test("sin texto falla claro", async () => {
    const r: any = await audioGenerateTool.execute({}, { configurable: { user_id: "u1" } });
    expect(r.ok).toBe(false);
  });
});
