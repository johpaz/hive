/**
 * Música de fondo del reel, generada con Lyria (Gemini API, Interactions). Es de pago (≈0,08 USD por canción, sin capa gratuita)
 * y se controla solo con texto, así que el pedido describe un instrumental suave según el tema del video. La duración exacta no
 * se puede fijar: al mezclar se recorta (con fundido de salida) o se repite hasta cubrir el reel.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apiKeyFor, geminiHttpError } from "../multimodal/image-generation"
import { logger } from "../utils/logger"
import { ffmpegRun } from "./voice"

const log = logger.child("video-music")

export const MUSIC_MODEL_ID = "lyria-3.5"
/** Plan B si el modelo principal falla: el de clips de 30 s (más barato, se repite si hace falta). */
export const MUSIC_FALLBACK_MODEL_ID = "lyria-3-clip-preview"
export const MUSIC_COST_USD = 0.08
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta"
const API_REVISION = "2026-05-20"
const TIMEOUT_MS = 240_000

export class MusicError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); this.name = "MusicError" }
}

/** Pedido de música: instrumental, suave y sin protagonismo, según el tema del reel (y el ánimo que pida el usuario). */
export function buildMusicPrompt(input: { title: string; brief?: string; mood?: string; seconds?: number }): string {
  const topic = [input.title, input.brief].map((t) => (t ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).join(". ").slice(0, 500)
  const mood = (input.mood ?? "").replace(/\s+/g, " ").trim().slice(0, 200)
  const secs = Math.max(15, Math.min(120, Math.round(input.seconds ?? 45)))
  return [
    `Soft, gentle background music for a short vertical social video of about ${secs} seconds. Topic: ${topic || "general"}.`,
    mood ? `Mood and style requested: ${mood}.` : "Choose a mood that fits the topic: warm, modern and unobtrusive.",
    "Low energy, steady and smooth, light percussion at most, no sudden changes, no drops, leaving room for a spoken voice on top.",
    "Instrumental only, no vocals.",
  ].join(" ")
}

interface InteractionResponse { status?: string; steps?: Array<{ type?: string; content?: Array<{ type?: string; mime_type?: string; data?: string }> }> }

export function parseMusic(json: InteractionResponse): { data: string | null; mimeType: string } {
  for (const step of json.steps ?? []) {
    for (const part of step.content ?? []) if (part.type === "audio" && part.data) return { data: part.data, mimeType: part.mime_type || "audio/mpeg" }
  }
  return { data: null, mimeType: "audio/mpeg" }
}

async function callLyria(model: string, prompt: string, apiKey: string, fetchImpl: typeof fetch): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const res = await fetchImpl(`${GEMINI_API}/interactions`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json", "Api-Revision": API_REVISION },
    body: JSON.stringify({ model, input: prompt }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await res.text()
  if (!res.ok) { const e = geminiHttpError(res.status, text, "generar música"); throw new MusicError(e.message, e.retryable) }
  let json: InteractionResponse
  try { json = JSON.parse(text) } catch { throw new MusicError("Gemini devolvió una respuesta que no es JSON.") }
  const found = parseMusic(json)
  if (!found.data) throw new MusicError("Gemini no devolvió música (puede que el filtro bloqueara el pedido).")
  const bytes = new Uint8Array(Buffer.from(found.data, "base64"))
  if (bytes.byteLength < 2000) throw new MusicError("La música generada llegó vacía.")
  return { bytes, mimeType: found.mimeType }
}

export interface GeneratedMusic { bytes: Uint8Array; mimeType: string; modelId: string; costUsd: number }

export async function generateMusic(prompt: string, opts: { fetchImpl?: typeof fetch } = {}): Promise<GeneratedMusic> {
  const apiKey = await apiKeyFor("gemini")
  if (!apiKey) throw new MusicError("Falta la API key del provider Gemini.")
  const fetchImpl = opts.fetchImpl ?? fetch
  let first: MusicError | null = null
  for (const [model, cost] of [[MUSIC_MODEL_ID, MUSIC_COST_USD], [MUSIC_FALLBACK_MODEL_ID, MUSIC_COST_USD / 2]] as const) {
    try {
      const out = await callLyria(model, prompt, apiKey, fetchImpl)
      log.info(`Música generada con ${model} (${out.bytes.byteLength} bytes)`)
      return { ...out, modelId: model, costUsd: cost }
    } catch (err) {
      const e = err instanceof MusicError ? err : new MusicError((err as Error).message ?? String(err), true)
      first ??= e
      // Un error de cuenta (clave, saldo, permisos) no mejora con otro modelo.
      if (!e.retryable && !/model|modelo|not found|no existe/i.test(e.message)) throw e
      log.warn(`Lyria ${model} falló: ${e.message}`)
    }
  }
  throw first ?? new MusicError("No se pudo generar la música.")
}

/** Mezcla la música bajo la voz del reel: volumen bajo, entra y sale con fundido, y se agacha sola mientras alguien habla. */
export async function mixBackgroundMusic(reel: Uint8Array, musicPath: string, opts: { volume: number; totalSec: number }): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), "hive-music-"))
  try {
    writeFileSync(join(dir, "reel.mp4"), reel)
    const total = Math.max(1, opts.totalSec)
    const fadeOut = Math.min(2.5, total / 3)
    const vol = Math.min(0.6, Math.max(0.02, opts.volume))
    // `-stream_loop -1` repite la canción si es más corta que el reel; `-t` la corta si es más larga.
    // Una voz mono pasada a estéreo con `aformat` pierde 3 dB; duplicar el canal la deja con su nivel original.
    const probe = Bun.spawnSync(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", join(dir, "reel.mp4")])
    const voiceToStereo = probe.stdout.toString().trim() === "1" ? "aformat=sample_rates=44100,pan=stereo|c0=c0|c1=c0" : "aformat=sample_rates=44100:channel_layouts=stereo"
    const graph =
      `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${vol.toFixed(3)},afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, total - fadeOut).toFixed(2)}:d=${fadeOut.toFixed(2)}[m];` +
      `[0:a]${voiceToStereo},asplit=2[v][sc];` +
      `[m][sc]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350[duck];` +
      `[v][duck]amix=inputs=2:duration=first:normalize=0:dropout_transition=0,alimiter=limit=0.95[a]`
    const hasAudio = (await ffmpegRun(["-v", "error", "-i", "reel.mp4", "-map", "0:a:0", "-f", "null", "-"], dir)).code === 0
    const args = hasAudio
      ? ["-y", "-i", "reel.mp4", "-stream_loop", "-1", "-i", musicPath, "-filter_complex", graph, "-map", "0:v", "-map", "[a]"]
      : ["-y", "-i", "reel.mp4", "-stream_loop", "-1", "-i", musicPath, "-filter_complex", `[1:a]volume=${Math.min(0.6, vol * 2).toFixed(3)},afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, total - fadeOut).toFixed(2)}:d=${fadeOut.toFixed(2)}[a]`, "-map", "0:v", "-map", "[a]"]
    const r = await ffmpegRun([...args, "-t", total.toFixed(2), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "out.mp4"], dir)
    if (r.code !== 0) throw new MusicError(`No se pudo mezclar la música: ${r.err.slice(-200)}`)
    return new Uint8Array(readFileSync(join(dir, "out.mp4")))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
