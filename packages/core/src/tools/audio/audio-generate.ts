/**
 * audio_generate — convierte un texto o un guion de varias voces en un audio (podcast, narración).
 *
 * Por omisión usa Kitten (local, gratis). Con `modelo` usa cualquier modelo TTS del catálogo
 * (ElevenLabs, OpenAI, Gemini, Groq, Qwen) con la API key de Providers. Cada turno se parte en
 * trozos cortos (Kitten corta a 30 s por llamada), se une con ffmpeg y se guarda como artifact MP3.
 *
 * @category audio
 * @seedId audio_generate
 * @spanish crear audio, generar audio, podcast, narración, texto a voz, locución
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "../types";
import { getWorkspace } from "../filesystem/workspace-guard";
import { createArtifact } from "../../artifacts/store";
import { voiceService } from "../../voice/index";
import { DEFAULT_LOCAL_VOICE, LOCAL_TTS_MODEL } from "../../voice/local-model";
import { getLocalTTSStatus, getLocalVoices, startLocalTTS } from "../../gateway/tts/kitten";
import { ffmpegRun } from "../../video/voice";

const MAX_CHARS_PER_CHUNK = 350;
const MAX_TOTAL_CHARS = 20_000;
const MAX_TURNS = 200;

export interface Turno { texto: string; voz?: string }

/** Parte un texto en trozos ≤ max respetando el final de las frases (o, a falta de él, las comas y los espacios). */
export function trocear(texto: string, max = MAX_CHARS_PER_CHUNK): string[] {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (!limpio) return [];
  const frases = limpio.match(/[^.!?…;:]+[.!?…;:]*\s*/g) ?? [limpio];
  const trozos: string[] = [];
  let actual = "";
  const volcar = () => { if (actual.trim()) trozos.push(actual.trim()); actual = ""; };
  for (const frase of frases) {
    if (frase.length > max) {
      volcar();
      let resto = frase;
      while (resto.length > max) {
        const corte = Math.max(resto.lastIndexOf(",", max), resto.lastIndexOf(" ", max));
        const i = corte > max * 0.4 ? corte + 1 : max;
        trozos.push(resto.slice(0, i).trim());
        resto = resto.slice(i);
      }
      actual = resto;
    } else if ((actual + frase).length > max) {
      volcar();
      actual = frase;
    } else {
      actual += frase;
    }
  }
  volcar();
  return trozos.filter(Boolean);
}

function turnosDe(params: Record<string, unknown>): Turno[] {
  if (Array.isArray(params.turnos) && params.turnos.length) {
    return (params.turnos as Array<Record<string, unknown>>).map((t) => ({
      texto: String(t.texto ?? t.text ?? "").trim(),
      voz: typeof t.voz === "string" && t.voz.trim() ? t.voz.trim() : undefined,
    })).filter((t) => t.texto);
  }
  const texto = typeof params.texto === "string" ? params.texto.trim() : "";
  const voz = typeof params.voz === "string" && params.voz.trim() ? params.voz.trim() : undefined;
  return texto ? [{ texto, voz }] : [];
}

const extDe = (mime: string) => (/wav/.test(mime) ? "wav" : /ogg|opus/.test(mime) ? "ogg" : /aac|mp4|m4a/.test(mime) ? "m4a" : /mpeg|mp3/.test(mime) ? "mp3" : "wav");

export const audioGenerateTool: Tool = {
  name: "audio_generate",
  // Un episodio largo son decenas de llamadas de síntesis en serie.
  timeoutMs: 600_000,
  description:
    "Create an audio file (podcast episode, narration, voice-over) from text. Pass `texto` for one voice or `turnos` [{texto, voz}] for a multi-voice dialogue (hosts alternating). " +
    "Default engine is the local Kitten TTS (free, Spanish); pass `modelo` (a TTS model id from audio_voices) to use ElevenLabs, OpenAI, Gemini, Groq or Qwen with their API key. " +
    "Long texts are split and joined automatically. Returns an artifact_id: deliver it with send_file (or attach it to an email). Write plain spoken text: no markdown, no stage directions. " +
    "Spanish: crear audio, generar audio, podcast, narración, locución, texto a voz, leer en voz alta",
  parameters: {
    type: "object",
    properties: {
      texto: { type: "string", description: "Text to speak with a single voice (alternative to `turnos`)." },
      turnos: {
        type: "array",
        description: "Dialogue: ordered turns [{texto, voz}]. Use a different `voz` per speaker. Max 200 turns.",
        items: { type: "object", properties: { texto: { type: "string" }, voz: { type: "string" } }, required: ["texto"] },
      },
      voz: { type: "string", description: "Voice id for `texto` (see audio_voices). Default: the local default voice." },
      modelo: { type: "string", description: "TTS model id (default: local Kitten). List them with audio_voices." },
      pausa_ms: { type: "number", description: "Silence between turns in ms (0-3000, default 500)." },
      titulo: { type: "string", description: "Title used to name the saved file." },
    },
    required: [],
  },
  execute: async (params, config) => {
    const userId = String(config?.configurable?.user_id ?? "");
    const turnos = turnosDe(params);
    if (!turnos.length) return { ok: false, error: "Falta el texto: pasa `texto` o `turnos`." };
    if (turnos.length > MAX_TURNS) return { ok: false, error: `Máximo ${MAX_TURNS} turnos por audio.` };
    const total = turnos.reduce((a, t) => a + t.texto.length, 0);
    if (total > MAX_TOTAL_CHARS) return { ok: false, error: `El guion tiene ${total} caracteres; el máximo por audio es ${MAX_TOTAL_CHARS}. Divídelo en episodios o partes.` };

    const modelo = typeof params.modelo === "string" && params.modelo.trim() ? params.modelo.trim() : LOCAL_TTS_MODEL;
    const local = modelo === LOCAL_TTS_MODEL;
    if (local) {
      const st = getLocalTTSStatus();
      if (!st.running) {
        if (st.phase === "stopped" || st.phase === "error") startLocalTTS();
        return {
          ok: false,
          retry_later: true,
          error: st.phase === "installing"
            ? "Kitten TTS se está instalando por primera vez (puede tardar unos minutos). Reintenta en un momento, o usa `modelo` con un proveedor en la nube."
            : "Kitten TTS está arrancando. Reintenta en unos segundos, o usa `modelo` con un proveedor en la nube.",
        };
      }
      const validas = new Set(getLocalVoices().map((v) => v.id));
      const mala = turnos.find((t) => t.voz && !validas.has(t.voz.toLowerCase()));
      if (mala) return { ok: false, error: `Voz local desconocida «${mala.voz}». Voces disponibles: ${[...validas].join(", ")}.` };
    }

    const pausa = Math.min(3000, Math.max(0, Number(params.pausa_ms ?? 500) || 0)) / 1000;
    const dir = mkdtempSync(join(tmpdir(), "hive-audio-gen-"));
    try {
      // Una entrada de ffmpeg por trozo; el último trozo de cada turno lleva la pausa.
      const archivos: Array<{ file: string; pausa: boolean }> = [];
      let n = 0;
      for (let t = 0; t < turnos.length; t++) {
        const turno = turnos[t]!;
        const trozos = trocear(turno.texto);
        for (let c = 0; c < trozos.length; c++) {
          let out;
          try {
            out = await voiceService.speak(trozos[c]!, modelo, turno.voz ?? (local ? DEFAULT_LOCAL_VOICE : undefined));
          } catch (err) {
            return { ok: false, error: `No se pudo sintetizar el turno ${t + 1} (trozo ${c + 1}): ${(err as Error).message}`, generados: n };
          }
          const bytes = typeof out.data === "string" ? Buffer.from(out.data, "base64") : out.data;
          const file = join(dir, `s${String(n++).padStart(4, "0")}.${extDe(out.mimeType)}`);
          writeFileSync(file, bytes);
          archivos.push({ file, pausa: c === trozos.length - 1 && t < turnos.length - 1 });
        }
      }
      if (!archivos.length) return { ok: false, error: "El texto no tiene nada que locutar." };

      const destino = join(dir, "episodio.mp3");
      const entradas = archivos.flatMap((a) => ["-i", a.file]);
      const filtro = archivos
        .map((a, i) => `[${i}:a]aresample=24000,aformat=sample_fmts=fltp:channel_layouts=mono${a.pausa && pausa > 0 ? `,apad=pad_dur=${pausa}` : ""}[a${i}]`)
        .join(";") + `;${archivos.map((_, i) => `[a${i}]`).join("")}concat=n=${archivos.length}:v=0:a=1[out]`;
      const r = await ffmpegRun(["-y", ...entradas, "-filter_complex", filtro, "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "128k", destino]);
      if (r.code !== 0) return { ok: false, error: `ffmpeg no pudo unir el audio: ${r.err}` };
      const mp3 = readFileSync(destino);

      const titulo = typeof params.titulo === "string" && params.titulo.trim() ? params.titulo.trim() : turnos[0]!.texto.slice(0, 40);
      const artifact = await createArtifact({
        bytes: mp3, mimeType: "audio/mpeg", kind: "generated_audio", userId,
        runId: config?.configurable?.run_id ?? null, taskId: config?.configurable?.task_id ?? null,
        expiresAt: null, extension: "mp3",
        visible: { workspace: getWorkspace(config), folder: "audios", label: titulo },
      });
      return {
        ok: true,
        artifact_id: artifact.id,
        ruta: artifact.path,
        bytes: artifact.size,
        modelo,
        turnos: turnos.length,
        trozos: archivos.length,
        nota: "Audio guardado en el equipo del usuario. Entrégalo con send_file({artifact_id}) o adjúntalo por correo con ese artifact_id; no pegues enlaces ni base64.",
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

export const audioVoicesTool: Tool = {
  name: "audio_voices",
  description:
    "List the voices and TTS models available for audio_generate: local Kitten voices (free) and the cloud TTS models of providers that have an API key. Spanish: voces disponibles, modelos de voz, qué voces hay",
  parameters: { type: "object", properties: {}, required: [] },
  execute: async () => {
    const { col } = await import("../../storage/hive");
    const { loadProviderApiKey } = await import("../../storage/crypto");
    const modelos = (await (await col<any>("models")).scan({}))
      .map((e: any) => e.doc)
      .filter((m: any) => m.model_type === "tts" && m.active !== false && !m.unlisted);
    const st = getLocalTTSStatus();
    const nube: Array<{ modelo: string; proveedor: string }> = [];
    for (const m of modelos) {
      if (m.provider_id === "kitten") continue;
      const tieneKey = !!(await loadProviderApiKey(m.provider_id).catch(() => null));
      if (tieneKey) nube.push({ modelo: m.id, proveedor: m.provider_id });
    }
    return {
      ok: true,
      local: { modelo: LOCAL_TTS_MODEL, listo: st.running, estado: st.phase, voces: getLocalVoices(), voz_por_defecto: DEFAULT_LOCAL_VOICE },
      nube,
      nota: "Voces de la nube: el id depende del proveedor (p. ej. ElevenLabs voice_id, OpenAI alloy/nova, Gemini Kore/Puck). Para varios locutores usa una `voz` distinta por turno.",
    };
  },
};
