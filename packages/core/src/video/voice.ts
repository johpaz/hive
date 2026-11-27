/**
 * Voz de los personajes con ElevenLabs.
 *
 * Gemini Omni no admite audio de referencia por la API pública, así que la voz del personaje
 * se genera aparte con ElevenLabs (una voz de la cuenta del usuario o una clonada de una muestra)
 * y se mezcla sobre el clip con ffmpeg. No hay sincronía labial: funciona como voz en off o para
 * personajes que no hablan a cámara, y el Director lo respeta al escribir las escenas.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apiKeyFor } from "../multimodal/image-generation"
import { logger } from "../utils/logger"

const log = logger.child("video-voice")
const API = "https://api.elevenlabs.io"
/** Modelo de reserva si la cuenta o la API no aceptan el elegido. */
export const FALLBACK_VOICE_MODEL = "eleven_multilingual_v2"

export interface VoiceModelInfo {
  id: string
  label: string
  /** v4 y v3: expresivos, controlados con etiquetas de audio; no admiten estilo ni velocidad. */
  expressive: boolean
}

/** Modelos de ElevenLabs que ofrece el estudio. v4 es el predeterminado. */
export const VOICE_MODELS: VoiceModelInfo[] = [
  { id: "eleven_v4", label: "Eleven v4 · el más expresivo", expressive: true },
  { id: "eleven_v4_turbo", label: "Eleven v4 Turbo · rápido", expressive: true },
  { id: "eleven_multilingual_v2", label: "Multilingual v2 · estable, con estilo y velocidad", expressive: false },
  { id: "eleven_flash_v2_5", label: "Flash v2.5 · el más económico", expressive: false },
]

/**
 * sync: Gemini habla la línea (labios) y la voz de ElevenLabs del personaje se genera con texto a voz y se ajusta, palabra por
 * palabra, a los tiempos del habla de Gemini: es TU voz y cae donde se mueven los labios.
 * convert: Gemini habla y ElevenLabs cambia esa voz por la del personaje (voice changer); conserva más rasgos de la voz de Gemini.
 * narration: ElevenLabs narra sobre el clip (sin labios).
 */
export type VoiceMode = "sync" | "convert" | "narration"

import { normalizeVoiceFx, type VoiceFxId } from "./voice-fx"

export interface VoiceSettings {
  /** Cómo se pone la voz del personaje. Por omisión «sync». */
  mode: VoiceMode
  /** Modelo de texto a voz (solo en modo narración; el cambio de voz usa su propio modelo). */
  model_id: string
  /** 0 creativa · 0,5 natural · 1 estable (en v4 se ofrecen solo esos tres valores). */
  stability: number
  similarity: number
  /** Solo modelos no expresivos. */
  style: number
  /** Solo modelos no expresivos (v4 ignora la velocidad). */
  speed: number
  /** Solo modelos no expresivos. */
  speaker_boost: boolean
  /** Volumen de la voz en la mezcla final (ganancia de 0,5 a 2; 1 = sin cambio). ElevenLabs no tiene volumen: lo aplica Hive. */
  volume: number
  /** Nivel del sonido ambiente del clip bajo la voz (0 a 1; 0,3 por omisión). */
  ambient_volume: number
  /** Efecto de voz que se aplica al armar el audio final (micrófono de estudio, radio, etc.). Gratis: no regenera nada. */
  fx: VoiceFxId
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  mode: "sync", model_id: "eleven_v4", stability: 0, similarity: 0.75, style: 0, speed: 1, speaker_boost: true, volume: 1, ambient_volume: 0.3, fx: "studio",
}
// Estabilidad «Creativa» (0) por omisión: en Eleven v4 es la que responde a las etiquetas de audio y varía la entonación; «Natural»
// (0,5) deja la lectura plana, sin los cambios de intensidad que hacen viva una locución de reel.

export const isExpressiveModel = (id: string) => VOICE_MODELS.find((m) => m.id === id)?.expressive ?? false

const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const v = typeof n === "number" ? n : Number(n)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
}

/** Completa y acota los ajustes: modelo conocido, estabilidad en {0, 0,5, 1} para v4, rangos válidos. */
export function normalizeVoiceSettings(input?: Partial<VoiceSettings> | null): VoiceSettings {
  const d = DEFAULT_VOICE_SETTINGS
  const model = VOICE_MODELS.some((m) => m.id === input?.model_id) ? (input!.model_id as string) : d.model_id
  let stability = clamp(input?.stability, 0, 1, d.stability)
  // v4 solo ofrece Creativa / Natural / Estable: se ajusta al valor más cercano.
  if (isExpressiveModel(model)) stability = ([0, 0.5, 1] as const).reduce((a, b) => (Math.abs(b - stability) < Math.abs(a - stability) ? b : a))
  return {
    mode: input?.mode === "narration" ? "narration" : input?.mode === "convert" ? "convert" : "sync",
    model_id: model,
    stability,
    similarity: clamp(input?.similarity, 0, 1, d.similarity),
    style: clamp(input?.style, 0, 1, d.style),
    speed: clamp(input?.speed, 0.7, 1.2, d.speed),
    speaker_boost: typeof input?.speaker_boost === "boolean" ? input.speaker_boost : d.speaker_boost,
    volume: clamp(input?.volume, 0.5, 2, d.volume),
    ambient_volume: clamp(input?.ambient_volume, 0, 1, d.ambient_volume),
    fx: normalizeVoiceFx(input?.fx, d.fx),
  }
}

/** Cuerpo de la solicitud: v4 solo recibe lo que admite (estabilidad y similitud); el resto, todo. */
export function ttsBody(text: string, settings: VoiceSettings): Record<string, unknown> {
  const voice_settings: Record<string, unknown> = { stability: settings.stability, similarity_boost: settings.similarity }
  if (!isExpressiveModel(settings.model_id)) {
    voice_settings.style = settings.style
    voice_settings.speed = settings.speed
    voice_settings.use_speaker_boost = settings.speaker_boost
  }
  return { text, model_id: settings.model_id, voice_settings }
}

/** Quita las etiquetas de audio ([whispering], [laughing]…): sirven a ElevenLabs, no son texto que decir ni que contar. */
export function stripAudioTags(text: string): string {
  return text.replace(/\[[^\]\n]{1,40}\]/g, "").replace(/[ \t]{2,}/g, " ").trim()
}

export const MAX_PREVIEW_CHARS = 300
/** Referencia para que el Director no escriba diálogos que no caben en el clip. */
export const MAX_DIALOGUE_CHARS_PER_SECOND = 14
export const MAX_SAMPLE_BYTES = 25 * 1024 * 1024

export class VoiceError extends Error {
  constructor(message: string, readonly code: "no_key" | "auth" | "plan" | "invalid" | "failed" = "failed") {
    super(message)
    this.name = "VoiceError"
  }
}

export interface VoiceInfo {
  voice_id: string
  name: string
  /** premade (de ElevenLabs), cloned (clonada), generated, professional… */
  category: string
  preview_url: string | null
}

export async function isVoiceEnabled(): Promise<boolean> {
  return !!(await apiKeyFor("elevenlabs"))
}

async function key(): Promise<string> {
  const k = await apiKeyFor("elevenlabs")
  if (!k) throw new VoiceError("Conecta una API key de ElevenLabs en Providers para usar voces.", "no_key")
  return k
}

async function failure(res: Response, what: string): Promise<VoiceError> {
  const text = await res.text().catch(() => "")
  let detail = ""
  let status = ""
  try {
    const j = JSON.parse(text) as { detail?: { message?: string; status?: string } | string }
    detail = typeof j.detail === "string" ? j.detail : (j.detail?.message ?? "")
    status = typeof j.detail === "object" ? (j.detail?.status ?? "") : ""
  } catch { detail = text.slice(0, 160) }
  if (res.status === 401 && /missing_permissions/i.test(`${status} ${detail}`)) {
    return new VoiceError(
      `La clave de ElevenLabs no tiene permiso para ${what}. En elevenlabs.io → Developers → API Keys edítala y activa «Text to Speech» y «Voices» (lectura; para clonar, también «Voice creation»).`, "auth")
  }
  if (res.status === 401) {
    return new VoiceError(
      "ElevenLabs no acepta la clave guardada (invalid_api_key). Aunque tenga el formato correcto (sk_…), puede estar revocada, ser de otra cuenta o haberse pegado incompleta. " +
      "Crea una nueva en elevenlabs.io → Developers → API Keys y pégala en Providers → ElevenLabs.", "auth")
  }
  if (res.status === 402 || /payment|subscription|upgrade|can_not_use_instant_voice_cloning|plan/i.test(`${status} ${detail}`)) {
    return new VoiceError(`Tu plan de ElevenLabs no permite ${what}. ${detail}`.trim(), "plan")
  }
  if (res.status === 422 || res.status === 400) return new VoiceError(`ElevenLabs rechazó la solicitud (${what}): ${detail}`.trim(), "invalid")
  return new VoiceError(`ElevenLabs falló (${what}, HTTP ${res.status}): ${detail}`.trim())
}

export async function listVoices(opts: { fetchImpl?: typeof fetch } = {}): Promise<VoiceInfo[]> {
  const k = await key()
  const res = await (opts.fetchImpl ?? fetch)(`${API}/v2/voices?page_size=100`, { headers: { "xi-api-key": k }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw await failure(res, "listar las voces")
  const j = await res.json() as { voices?: Array<{ voice_id: string; name: string; category?: string; preview_url?: string | null }> }
  return (j.voices ?? []).map((v) => ({ voice_id: v.voice_id, name: v.name, category: v.category ?? "premade", preview_url: v.preview_url ?? null }))
    // Las propias y clonadas primero: son las que el usuario espera ver.
    .sort((a, b) => Number(a.category === "premade") - Number(b.category === "premade") || a.name.localeCompare(b.name))
}

/**
 * Clona una voz (clonación instantánea) a partir de una muestra. Exige confirmar que la voz es
 * del usuario o que tiene permiso de su dueño: sin eso no se llama a ElevenLabs.
 */
export async function cloneVoice(
  input: { name: string; bytes: Uint8Array; mimeType: string; consent: boolean },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<VoiceInfo> {
  const name = input.name?.trim()
  if (!name) throw new VoiceError("Ponle un nombre a la voz.", "invalid")
  if (!input.consent) throw new VoiceError("Confirma que la voz es tuya o que tienes permiso de su dueño antes de clonarla.", "invalid")
  if (input.bytes.byteLength < 1000) throw new VoiceError("La muestra de audio está vacía o es demasiado corta.", "invalid")
  if (input.bytes.byteLength > MAX_SAMPLE_BYTES) throw new VoiceError("La muestra pesa más de 25 MB.", "invalid")
  const k = await key()
  const ext = input.mimeType.includes("wav") ? "wav" : input.mimeType.includes("mp4") || input.mimeType.includes("m4a") ? "m4a" : input.mimeType.includes("webm") ? "webm" : input.mimeType.includes("ogg") ? "ogg" : "mp3"
  const form = new FormData()
  form.append("name", name.slice(0, 80))
  form.append("files", new Blob([new Uint8Array(input.bytes)], { type: input.mimeType || "audio/mpeg" }), `muestra.${ext}`)
  form.append("remove_background_noise", "true")
  form.append("description", "Clonada desde Hive (Estudio de video) con el consentimiento del usuario.")
  const res = await (opts.fetchImpl ?? fetch)(`${API}/v1/voices/add`, { method: "POST", headers: { "xi-api-key": k }, body: form, signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw await failure(res, "clonar voces")
  const j = await res.json() as { voice_id?: string }
  if (!j.voice_id) throw new VoiceError("ElevenLabs no devolvió el identificador de la voz clonada.")
  log.info(`Voz clonada «${name}» (${input.bytes.byteLength} bytes de muestra)`)
  return { voice_id: j.voice_id, name, category: "cloned", preview_url: null }
}

/** Genera el audio de una línea con la voz indicada. Devuelve MP3. */
export async function synthesizeLine(
  input: { voiceId: string; text: string; settings?: Partial<VoiceSettings> | null }, opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ bytes: Uint8Array; modelId: string }> {
  const text = input.text.trim()
  if (!text) throw new VoiceError("No hay texto que narrar.", "invalid")
  const k = await key()
  const wanted = normalizeVoiceSettings(input.settings)
  // Primero el modelo elegido; si la cuenta no lo acepta, el de reserva con sus ajustes equivalentes.
  const chain = [wanted.model_id, FALLBACK_VOICE_MODEL].filter((m, i, a) => a.indexOf(m) === i)
  let last: VoiceError | null = null
  for (const modelId of chain) {
    const settings = modelId === wanted.model_id ? wanted : normalizeVoiceSettings({ ...wanted, model_id: modelId })
    const res = await (opts.fetchImpl ?? fetch)(`${API}/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": k, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify(ttsBody(text, settings)),
      signal: AbortSignal.timeout(90_000),
    })
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.byteLength < 200) throw new VoiceError("ElevenLabs devolvió un audio vacío.")
      return { bytes, modelId }
    }
    const err = await failure(res, "generar la voz")
    // Un modelo no disponible para esta cuenta (400/422) se intenta con el siguiente; lo demás no se arregla cambiando de modelo.
    if (err.code !== "invalid") throw err
    last = err
  }
  throw last ?? new VoiceError("No se pudo generar la voz.")
}

export async function durationOf(path: string): Promise<number> {
  try {
    const p = Bun.spawn(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { stdout: "pipe", stderr: "ignore" })
    const out = await new Response(p.stdout as ReadableStream).text()
    await p.exited
    const n = Number(out.trim())
    return Number.isFinite(n) ? n : 0
  } catch { return 0 }
}

/** Ganancias de la mezcla final (ver VoiceSettings.volume y ambient_volume). */
export interface MixOptions {
  voiceGain?: number
  ambientGain?: number
}

/**
 * Mezcla la voz sobre el clip: el audio ambiente del clip baja a `ambientGain` (0,3 por omisión) y la
 * voz va al frente con `voiceGain` (1 por omisión). Un limitador evita que subir la voz distorsione.
 * Si la voz dura más que el clip se acelera hasta 1,3x; si aun así no cabe, se recorta al largo del clip.
 */
export async function mixDialogue(clip: Uint8Array, voice: Uint8Array, mix: MixOptions = {}): Promise<Uint8Array> {
  const voiceGain = clamp(mix.voiceGain, 0.5, 2, 1)
  const ambientGain = clamp(mix.ambientGain, 0, 1, 0.3)
  const dir = mkdtempSync(join(tmpdir(), "hive-dub-"))
  try {
    const clipPath = join(dir, "clip.mp4")
    const voicePath = join(dir, "voice.mp3")
    const out = join(dir, "out.mp4")
    writeFileSync(clipPath, clip)
    writeFileSync(voicePath, voice)
    const [clipSec, voiceSec] = await Promise.all([durationOf(clipPath), durationOf(voicePath)])
    const tempo = clipSec > 0 && voiceSec > clipSec ? Math.min(1.3, voiceSec / clipSec) : 1
    const voiceChain = `[1:a]${tempo > 1.01 ? `atempo=${tempo.toFixed(3)},` : ""}volume=${voiceGain.toFixed(3)}[v]`
    const filters = (limiter: boolean, ambient: boolean) => {
      const tail = limiter ? ",alimiter=limit=0.97" : ""
      return ambient
        // clip con audio ambiente: se ajusta y se mezcla con la voz
        ? `[0:a]volume=${ambientGain.toFixed(3)}[a0];${voiceChain};[a0][v]amix=inputs=2:duration=first:dropout_transition=0:normalize=0${tail}[a]`
        // clip sin pista de audio: solo la voz
        // Sin audio propio (tarjetas, imágenes): la voz se rellena con silencio hasta el largo del clip; si no, `-shortest` recortaría el video a lo que dura la voz.
        : `${voiceChain.replace("[v]", "[v0]")};[v0]${clipSec > 0 ? `apad=whole_dur=${clipSec.toFixed(3)},` : ""}anull${tail}[a]`
    }
    // Primero con limitador; si ese ffmpeg no lo trae, sin él. Con ambiente y, si el clip no tiene audio, solo voz.
    const attempts = [filters(true, true), filters(false, true), filters(true, false), filters(false, false)]
    let lastError = ""
    for (const filter of attempts) {
      rmSync(out, { force: true })
      const proc = Bun.spawn(
        ["ffmpeg", "-v", "error", "-y", "-i", clipPath, "-i", voicePath, "-filter_complex", filter, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", out],
        { stdout: "ignore", stderr: "pipe" },
      )
      const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr as ReadableStream).text()])
      if (code === 0) return new Uint8Array(readFileSync(out))
      lastError = err.slice(0, 300)
    }
    throw new VoiceError(`No se pudo mezclar la voz con el clip: ${lastError}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}


// ─── Cambio de voz (labios sincronizados) ────────────────────────────────────

/** Modelo de ElevenLabs para el cambio de voz: conserva el tiempo y la entonación de quien habla. */
export const VOICE_CHANGER_MODEL = "eleven_multilingual_sts_v2"

/**
 * Cambia la voz de un audio por la de `voiceId` conservando el tiempo, el ritmo y la entonación, así que los
 * labios que Gemini movió al hablar siguen coincidiendo. `remove_background_noise` quita música y ambiente del audio de entrada.
 */
export async function convertVoice(
  input: { voiceId: string; audio: Uint8Array; mimeType?: string; settings?: Partial<VoiceSettings> | null },
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ bytes: Uint8Array }> {
  const k = await key()
  const s = normalizeVoiceSettings(input.settings)
  const build = () => {
    const form = new FormData()
    form.append("audio", new Blob([new Uint8Array(input.audio)], { type: input.mimeType ?? "audio/wav" }), "habla.wav")
    form.append("model_id", VOICE_CHANGER_MODEL)
    form.append("voice_settings", JSON.stringify({ stability: s.stability, similarity_boost: s.similarity }))
    form.append("remove_background_noise", "true")
    return form
  }
  const f = opts.fetchImpl ?? fetch
  // La documentación muestra dos rutas según la página; se prueba la histórica y, si no existe, la nueva.
  let res = await f(`${API}/v1/speech-to-speech/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_128`, {
    method: "POST", headers: { "xi-api-key": k }, body: build(), signal: AbortSignal.timeout(120_000),
  })
  if (res.status === 404) {
    res = await f(`${API}/v1/voice-changer/${encodeURIComponent(input.voiceId)}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": k }, body: build(), signal: AbortSignal.timeout(120_000),
    })
  }
  if (!res.ok) throw await failure(res, "cambiar la voz")
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength < 200) throw new VoiceError("ElevenLabs devolvió un audio vacío al cambiar la voz.")
  return { bytes }
}

// ─── Tiempos de las palabras y subtítulos ────────────────────────────────────

export interface WordTiming {
  text: string
  /** Segundos desde el inicio del clip. */
  start: number
  end: number
}

/** Tiempos de cada palabra con el alineado forzado de ElevenLabs (audio + el texto que se dice). */
export async function alignWords(
  input: { audio: Uint8Array; mimeType?: string; text: string }, opts: { fetchImpl?: typeof fetch } = {},
): Promise<WordTiming[]> {
  const k = await key()
  const form = new FormData()
  form.append("file", new Blob([new Uint8Array(input.audio)], { type: input.mimeType ?? "audio/mpeg" }), "voz.mp3")
  form.append("text", input.text)
  const res = await (opts.fetchImpl ?? fetch)(`${API}/v1/forced-alignment`, { method: "POST", headers: { "xi-api-key": k }, body: form, signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw await failure(res, "alinear las palabras")
  const j = await res.json() as { words?: Array<{ text?: string; start?: number; end?: number }> }
  const words = (j.words ?? [])
    .filter((w) => typeof w.text === "string" && w.text.trim() && Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ text: w.text!.trim(), start: w.start!, end: w.end! }))
  if (words.length === 0) throw new VoiceError("ElevenLabs no devolvió los tiempos de las palabras.")
  return words
}

export async function ffmpegRun(args: string[], cwd?: string): Promise<{ code: number; err: string }> {
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn(["ffmpeg", "-hide_banner", "-v", "error", ...args], { stdout: "ignore", stderr: "pipe", cwd })
  } catch {
    throw new VoiceError("No se encontró ffmpeg: instálalo para editar el audio y los subtítulos del reel.")
  }
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr as ReadableStream).text()])
  return { code, err: err.slice(0, 300) }
}

/** Audio de un clip como WAV mono de 44,1 kHz (lo que espera el cambio de voz). */
export async function extractAudio(clip: Uint8Array): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), "hive-audio-"))
  try {
    writeFileSync(join(dir, "clip.mp4"), clip)
    const r = await ffmpegRun(["-y", "-i", join(dir, "clip.mp4"), "-vn", "-ac", "1", "-ar", "44100", join(dir, "a.wav")])
    if (r.code !== 0) throw new VoiceError(`El clip no tiene audio utilizable: ${r.err}`)
    return new Uint8Array(readFileSync(join(dir, "a.wav")))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

/**
 * Dónde empieza y termina el habla en un audio (detección de silencios). Un clip de Gemini no empieza a hablar en
 * el segundo 0 y su sala tiene ruido de fondo: se prueban umbrales de más a menos estricto hasta hallar un tramo
 * de habla claro, y se ignoran los fragmentos muy cortos (soplidos). Sirve de respaldo para los subtítulos.
 */
export async function speechSpan(audio: Uint8Array): Promise<{ start: number; end: number; duration: number }> {
  const dir = mkdtempSync(join(tmpdir(), "hive-vad-"))
  try {
    const path = join(dir, "a.wav")
    writeFileSync(path, audio)
    const duration = await durationOf(path)
    let fallback: { start: number; end: number } | null = null
    for (const noise of ["-30dB", "-35dB", "-40dB"]) {
      const proc = Bun.spawn(["ffmpeg", "-hide_banner", "-i", path, "-af", `silencedetect=noise=${noise}:d=0.2`, "-f", "null", "-"], { stdout: "ignore", stderr: "pipe" })
      const [, log] = await Promise.all([proc.exited, new Response(proc.stderr as ReadableStream).text()])
      const starts = [...log.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Math.max(0, Number(m[1])))
      const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]))
      // Tramos con habla = lo que queda entre los silencios.
      const segments: Array<{ start: number; end: number }> = []
      let cursor = 0
      for (let i = 0; i < starts.length; i++) {
        if (starts[i] - cursor > 0.02) segments.push({ start: cursor, end: starts[i] })
        cursor = ends[i] ?? duration
      }
      if (duration - cursor > 0.02) segments.push({ start: cursor, end: duration })
      const real = segments.filter((sg) => sg.end - sg.start >= 0.25)
      if (real.length === 0) continue
      const span = { start: real[0].start, end: real[real.length - 1].end }
      // Un umbral que deja «habla» en todo el audio no separó nada: se prueba el siguiente y este queda de respaldo.
      if (span.end - span.start < duration * 0.97 || span.start > 0.05) return { ...span, duration }
      fallback ??= span
    }
    return { ...(fallback ?? { start: 0, end: duration }), duration }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

/** Reparte las palabras en el tramo hablado según su largo (y una pausa más larga tras la puntuación). Respaldo si no hay alineado. */
export function spreadWords(text: string, span: { start: number; end: number }): WordTiming[] {
  const words = stripAudioTags(text).split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const weight = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "").length + 1 + (/[.,;:!?…]$/.test(w) ? 2 : 0)
  const total = words.reduce((n, w) => n + weight(w), 0)
  const len = Math.max(0.2, span.end - span.start)
  let t = span.start
  return words.map((w) => {
    const dur = (weight(w) / total) * len
    const out = { text: w, start: t, end: t + dur }
    t += dur
    return out
  })
}

const fmtAss = (sec: number) => {
  const s = Math.max(0, sec)
  const cs = Math.round((s % 1) * 100)
  const whole = Math.floor(s)
  return `${Math.floor(whole / 3600)}:${String(Math.floor((whole % 3600) / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`
}

/** Agrupa las palabras en subtítulos de hasta `maxWords`, cortando en la puntuación. */
export function groupCaptions(words: WordTiming[], maxWords = 4): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = []
  let cur: WordTiming[] = []
  const flush = () => {
    if (cur.length === 0) return
    out.push({ text: cur.map((w) => w.text).join(" "), start: cur[0].start, end: cur[cur.length - 1].end })
    cur = []
  }
  for (const w of words) {
    cur.push(w)
    if (cur.length >= maxWords || /[.!?…;,]$/.test(w.text)) flush()
  }
  flush()
  // Cada subtítulo aguanta un instante tras la última palabra y nunca se solapa con el siguiente.
  return out.map((c, i) => ({ ...c, end: Math.min(c.end + 0.2, out[i + 1]?.start ?? Infinity) }))
}

/** Subtítulos ASS en la zona segura inferior (arriba de los controles de las redes), con borde para leerse sobre cualquier fondo. */
export function buildAss(words: WordTiming[], dims: { width: number; height: number }): string {
  const { width, height } = dims
  const vertical = height >= width
  const fontSize = Math.round(height * (vertical ? 0.042 : 0.06))
  const outline = Math.max(2, Math.round(fontSize * 0.09))
  const marginV = Math.round(height * (vertical ? 0.17 : 0.09))
  const marginH = Math.round(width * 0.07)
  const clean = (t: string) => t.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim()
  const lines = groupCaptions(words).map((c) => `Dialogue: 0,${fmtAss(c.start)},${fmtAss(c.end)},Hive,,0,0,0,,${clean(c.text)}`)
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${width}`, `PlayResY: ${height}`, "WrapStyle: 0", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Hive,Montserrat,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,${outline},1,2,${marginH},${marginH},${marginV},1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ...lines, "",
  ].join("\n")
}

export async function probeDims(path: string): Promise<{ width: number; height: number }> {
  try {
    const p = Bun.spawn(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], { stdout: "pipe", stderr: "ignore" })
    const out = await new Response(p.stdout as ReadableStream).text()
    await p.exited
    const [w, h] = out.trim().split(",").map(Number)
    if (w > 0 && h > 0) return { width: w, height: h }
  } catch { /* se usa el valor por omisión */ }
  return { width: 720, height: 1280 }
}

/** Graba los subtítulos en el video (hay que recodificar el video; el audio no se toca). */
export async function burnSubtitles(clip: Uint8Array, words: WordTiming[]): Promise<Uint8Array> {
  if (words.length === 0) return clip
  const dir = mkdtempSync(join(tmpdir(), "hive-subs-"))
  try {
    writeFileSync(join(dir, "clip.mp4"), clip)
    writeFileSync(join(dir, "subs.ass"), buildAss(words, await probeDims(join(dir, "clip.mp4"))))
    // Este ffmpeg puede no traer libx264: se prueba H.264 de OpenH264 y, si no, MPEG-4.
    const encoders = [
      ["-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p"],
      ["-c:v", "libopenh264", "-b:v", "6M", "-pix_fmt", "yuv420p"],
      ["-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p"],
    ]
    let last = ""
    for (const enc of encoders) {
      rmSync(join(dir, "out.mp4"), { force: true })
      // `ass=subs.ass` relativo al directorio de trabajo: evita escapar rutas dentro del filtro.
      const r = await ffmpegRun(["-y", "-i", "clip.mp4", "-vf", "ass=subs.ass", ...enc, "-c:a", "copy", "-movflags", "+faststart", "out.mp4"], dir)
      if (r.code === 0) return new Uint8Array(readFileSync(join(dir, "out.mp4")))
      last = r.err
    }
    throw new VoiceError(`No se pudieron grabar los subtítulos: ${last}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

/** Cambia el audio de un clip por otro (la voz ya cambiada) con el volumen elegido y un limitador. El video no se recodifica. */
export async function replaceAudio(clip: Uint8Array, audio: Uint8Array, gain = 1): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), "hive-swap-"))
  try {
    writeFileSync(join(dir, "clip.mp4"), clip)
    writeFileSync(join(dir, "voz.mp3"), audio)
    const clipSec = await durationOf(join(dir, "clip.mp4"))
    const g = clamp(gain, 0.5, 2, 1)
    // `apad` + `-t`: si la voz dura menos que el clip se rellena con silencio; si dura más, se corta al largo del clip.
    const r = await ffmpegRun([
      "-y", "-i", "clip.mp4", "-i", "voz.mp3", "-filter_complex", `[1:a]volume=${g.toFixed(3)},alimiter=limit=0.97,apad[a]`,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", ...(clipSec > 0 ? ["-t", clipSec.toFixed(3)] : []), "-movflags", "+faststart", "out.mp4",
    ], dir)
    if (r.code !== 0) throw new VoiceError(`No se pudo poner la voz en el clip: ${r.err}`)
    return new Uint8Array(readFileSync(join(dir, "out.mp4")))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}


// ─── Voz propia ajustada a los labios (modo «sync») ──────────────────────────

/** Palabras con tiempos a partir de la alineación por caracteres de ElevenLabs. Ignora lo que va entre corchetes (etiquetas de audio). */
export function wordsFromCharacters(alignment: { characters?: string[]; character_start_times_seconds?: number[]; character_end_times_seconds?: number[] }): WordTiming[] {
  const ch = alignment.characters ?? []
  const st = alignment.character_start_times_seconds ?? []
  const en = alignment.character_end_times_seconds ?? []
  const words: WordTiming[] = []
  let cur: { text: string; start: number; end: number } | null = null
  let inTag = false
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i]
    if (c === "[") { inTag = true; continue }
    if (c === "]") { inTag = false; continue }
    if (inTag) continue
    if (/\s/.test(c)) { if (cur) { words.push(cur); cur = null } continue }
    if (!cur) cur = { text: c, start: st[i] ?? 0, end: en[i] ?? st[i] ?? 0 }
    else { cur.text += c; cur.end = en[i] ?? cur.end }
  }
  if (cur) words.push(cur)
  return words
}

/** Como `synthesizeLine`, pero devuelve también cuándo se dice cada palabra (endpoint con tiempos de ElevenLabs). */
export async function synthesizeLineTimed(
  input: { voiceId: string; text: string; settings?: Partial<VoiceSettings> | null }, opts: { fetchImpl?: typeof fetch } = {},
): Promise<{ bytes: Uint8Array; modelId: string; words: WordTiming[] }> {
  const text = input.text.trim()
  if (!text) throw new VoiceError("No hay texto que narrar.", "invalid")
  const k = await key()
  const wanted = normalizeVoiceSettings(input.settings)
  const chain = [wanted.model_id, FALLBACK_VOICE_MODEL].filter((m, i, a) => a.indexOf(m) === i)
  let last: VoiceError | null = null
  for (const modelId of chain) {
    const settings = modelId === wanted.model_id ? wanted : normalizeVoiceSettings({ ...wanted, model_id: modelId })
    const res = await (opts.fetchImpl ?? fetch)(`${API}/v1/text-to-speech/${encodeURIComponent(input.voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": k, "Content-Type": "application/json" },
      body: JSON.stringify(ttsBody(text, settings)), signal: AbortSignal.timeout(90_000),
    })
    if (res.ok) {
      const j = await res.json() as { audio_base64?: string; alignment?: Parameters<typeof wordsFromCharacters>[0]; normalized_alignment?: Parameters<typeof wordsFromCharacters>[0] }
      if (!j.audio_base64) throw new VoiceError("ElevenLabs no devolvió el audio.")
      const bytes = new Uint8Array(Buffer.from(j.audio_base64, "base64"))
      if (bytes.byteLength < 200) throw new VoiceError("ElevenLabs devolvió un audio vacío.")
      return { bytes, modelId, words: wordsFromCharacters(j.alignment ?? j.normalized_alignment ?? {}) }
    }
    const err = await failure(res, "generar la voz con tiempos")
    if (err.code !== "invalid") throw err
    last = err
  }
  throw last ?? new VoiceError("No se pudo generar la voz.")
}

/** Audio decodificado a PCM f32 mono de 44,1 kHz (para buscar los puntos más silenciosos donde cortar). */
async function decodePcm(bytes: Uint8Array): Promise<Float32Array> {
  const dir = mkdtempSync(join(tmpdir(), "hive-pcm-"))
  try {
    writeFileSync(join(dir, "a.bin"), bytes)
    const proc = Bun.spawn(["ffmpeg", "-v", "error", "-i", join(dir, "a.bin"), "-vn", "-ac", "1", "-ar", "44100", "-f", "f32le", "-"], { stdout: "pipe", stderr: "ignore" })
    const buf = await new Response(proc.stdout as ReadableStream).arrayBuffer()
    await proc.exited
    return new Float32Array(buf)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

const PCM_SR = 44100

/**
 * El punto de menor energía cerca de `center` (±35 ms), ajustado al cruce por cero más próximo. Cortar y pegar la voz ahí no deja
 * chasquidos: cortar exactamente en el borde de una palabra, que suele ser mitad de una sílaba, sí los deja.
 */
export function quietestPoint(pcm: Float32Array, center: number, radius = 0.035): number {
  const win = Math.round(PCM_SR * 0.004)
  const step = Math.max(1, Math.round(PCM_SR * 0.001))
  const lo = Math.max(win, Math.round((center - radius) * PCM_SR))
  const hi = Math.min(pcm.length - win - 1, Math.round((center + radius) * PCM_SR))
  if (hi <= lo) return Math.min(Math.max(center, 0), pcm.length / PCM_SR)
  let best = lo
  let bestE = Infinity
  for (let i = lo; i <= hi; i += step) {
    let e = 0
    for (let k = 0; k < win; k++) e += pcm[i + k] * pcm[i + k]
    if (e < bestE) { bestE = e; best = i + (win >> 1) }
  }
  const reach = Math.round(PCM_SR * 0.002)
  for (let d = 0; d <= reach; d++) {
    for (const j of [best + d, best - d]) if (j > 0 && j < pcm.length && pcm[j - 1] * pcm[j] <= 0) return j / PCM_SR
  }
  return best / PCM_SR
}

/** Rangos de estirado que se prueban, de más natural a más forzado, hasta que la voz cabe en el clip. */
const STRETCH_STEPS: Array<[number, number]> = [[0.9, 1.12], [0.82, 1.25], [0.72, 1.4], [0.6, 1.6]]

interface PlacedPiece { src0: number; src1: number; at: number; ratio: number }

/**
 * Reparte las palabras de la voz sobre la línea de tiempo del clip. Cada palabra arranca donde Gemini mueve los labios, pero se
 * reproduce casi a su ritmo natural (estirada solo dentro de `range`): lo que sobra o falta se absorbe en las pausas. Si una
 * palabra se desborda, la siguiente se retrasa un poco y se recupera en la primera pausa, en vez de acelerar o arrastrar la voz.
 */
function placePieces(
  cuts: number[], words: Array<{ s: number; e: number }>, targets: Array<{ c: number; d: number }>, range: [number, number],
): { pieces: PlacedPiece[]; end: number } {
  const pieces: PlacedPiece[] = []
  let cursor = 0
  for (let i = 0; i < words.length; i++) {
    const w = words[i], t = targets[i]
    const ratio = Math.min(range[1], Math.max(range[0], (w.e - w.s) / Math.max(0.04, t.d)))
    // El trozo es la palabra con un margen de 60 ms: la pausa natural del origen no se arrastra, la pausa la decide la línea de tiempo.
    const src0 = Math.max(cuts[i], w.s - 0.06), src1 = Math.min(cuts[i + 1], w.e + 0.06)
    const lead = (w.s - src0) / ratio                            // lo que hay antes de la palabra dentro del trozo
    const at = Math.max(cursor, Math.max(0, t.c - lead))
    pieces.push({ src0, src1, at, ratio })
    cursor = at + (src1 - src0) / ratio
  }
  return { pieces, end: cursor }
}

/**
 * Ajusta una voz (texto a voz) a los tiempos de otra: cada palabra de `from` arranca donde empieza la palabra correspondiente de
 * `to`, de modo que la voz de ElevenLabs cae donde Gemini mueve los labios. Con distinto número de palabras se ajusta el habla
 * completa de una vez. Devuelve un WAV mono de 44,1 kHz de `totalSec`, con el volumen nivelado.
 *
 * Para que suene natural: las palabras casi no se estiran (±12 % y solo se amplía el rango si la voz no cabe en el clip), los
 * trozos se cortan en el punto más silencioso de cada hueco, cada empalme lleva un fundido de 4 ms y el estirado usa `rubberband`
 * (calidad de voz). Al final se nivela el volumen (la voz de ElevenLabs sale mucho más baja que la de Gemini).
 */
export async function warpToTiming(
  tts: Uint8Array, from: WordTiming[], to: WordTiming[], totalSec: number,
): Promise<Uint8Array> {
  if (from.length === 0 || to.length === 0) throw new VoiceError("No hay tiempos de palabras para ajustar la voz.")
  const pcm = await decodePcm(tts)
  const srcDur = pcm.length / PCM_SR
  const PAD = 0.02
  const equal = from.length === to.length
  const words = equal ? from.map((f) => ({ s: f.start, e: f.end })) : [{ s: from[0].start, e: from[from.length - 1].end }]
  const targets = equal ? to.map((t) => ({ c: t.start, d: t.end - t.start })) : [{ c: to[0].start, d: to[to.length - 1].end - to[0].start }]
  const n = words.length
  // Cortes en el origen: antes de la primera palabra, en el punto más silencioso de cada hueco y tras la última.
  const cuts: number[] = [Math.max(0, words[0].s - PAD)]
  for (let i = 1; i < n; i++) {
    const g0 = words[i - 1].e, g1 = Math.max(g0, words[i].s)
    cuts.push(Math.min(g1, Math.max(g0, quietestPoint(pcm, (g0 + g1) / 2))))
  }
  cuts.push(Math.min(srcDur, words[n - 1].e + PAD))
  for (let i = 1; i < cuts.length; i++) cuts[i] = Math.min(srcDur, Math.max(cuts[i], cuts[i - 1]))

  // Se elige el rango de estirado más natural con el que la voz entera cabe en el clip.
  let plan = placePieces(cuts, words, targets, STRETCH_STEPS[0])
  for (const range of STRETCH_STEPS.slice(1)) {
    if (plan.end <= totalSec - 0.05) break
    plan = placePieces(cuts, words, targets, range)
  }

  const build = (mode: "rubberband" | "atempo" | "none") => {
    const nodes: string[] = []
    const labels: string[] = []
    const fmt = "aformat=sample_rates=44100:channel_layouts=mono"
    const FADE = 0.004
    let seq = 0, cursor = 0
    const silence = (sec: number) => {
      if (sec < 0.004) return
      const tag = `s${seq++}`
      nodes.push(`anullsrc=r=44100:cl=mono,atrim=0:${sec.toFixed(4)},${fmt}[${tag}]`)
      labels.push(`[${tag}]`)
    }
    for (const pc of plan.pieces) {
      silence(pc.at - cursor)
      const sa = Math.min(Math.max(0, pc.src0), srcDur), sb = Math.min(Math.max(0, pc.src1), srcDur)
      const src = sb - sa
      if (src < 0.004) { cursor = Math.max(cursor, pc.at); continue }
      const out = src / pc.ratio
      const stretch = mode === "none" || src < 0.06 || Math.abs(pc.ratio - 1) < 0.02 ? "anull"
        : mode === "rubberband" ? `rubberband=tempo=${pc.ratio.toFixed(4)}:pitch=1:formant=preserved:transients=mixed` : `atempo=${pc.ratio.toFixed(4)}`
      const eff = stretch === "anull" ? src : out
      const f = Math.min(FADE, eff / 2)
      const tag = `p${seq++}`
      nodes.push(
        `[0:a]atrim=${sa.toFixed(4)}:${sb.toFixed(4)},asetpts=PTS-STARTPTS,${stretch},apad=whole_dur=${eff.toFixed(4)},atrim=0:${eff.toFixed(4)},` +
        `afade=t=in:d=${f.toFixed(4)},afade=t=out:st=${(eff - f).toFixed(4)}:d=${f.toFixed(4)},${fmt}[${tag}]`,
      )
      labels.push(`[${tag}]`)
      cursor = pc.at + eff
    }
    silence(Math.max(0, totalSec - cursor))
    // Nivelado final: la voz de ElevenLabs sale ~10 dB por debajo de la de Gemini y quedaba enterrada.
    return nodes.join(";") + `;${labels.join("")}concat=n=${labels.length}:v=0:a=1[cat];[cat]apad=whole_dur=${(totalSec + 0.2).toFixed(4)},loudnorm=I=-16:TP=-1.5:LRA=9,aresample=44100,atrim=0:${totalSec.toFixed(4)}[a]`
  }

  const dir = mkdtempSync(join(tmpdir(), "hive-warp-"))
  try {
    // El MP3 se pasa antes a WAV: leer un mismo MP3 desde muchos trozos a la vez hace fallar el filtro («Invalid data found»).
    writeFileSync(join(dir, "tts.bin"), tts)
    const conv = await ffmpegRun(["-y", "-i", "tts.bin", "-vn", "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", "tts.wav"], dir)
    if (conv.code !== 0) throw new VoiceError(`No se pudo leer el audio de la voz: ${conv.err.slice(-200)}`)
    let last = ""
    for (const mode of ["rubberband", "atempo", "none"] as const) {
      const r = await ffmpegRun(["-y", "-i", "tts.wav", "-filter_complex", build(mode), "-map", "[a]", "-t", totalSec.toFixed(3), "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", "warp.wav"], dir)
      if (r.code === 0) return new Uint8Array(readFileSync(join(dir, "warp.wav")))
      last = r.err
    }
    throw new VoiceError(`No se pudo ajustar la voz a los labios: ${last}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// ─── Voz de Gemini (texto a voz) ─────────────────────────────────────────────

export const GEMINI_TTS_MODEL = "gemini-3.8-flash-tts"
/** Respaldo si el modelo nuevo no responde (misma clave, API generateContent). */
export const GEMINI_TTS_FALLBACK = "gemini-2.5-flash-preview-tts"
export const GEMINI_TTS_VOICE = "Kore"
const GEMINI_TTS_STYLE = "energetic, expressive Spanish reel narrator with natural rhythm, emphasizing the key words"

/** PCM 16 bits mono → WAV. */
export function pcmToWav(pcm: Uint8Array, rate = 24000): Uint8Array {
  const h = Buffer.alloc(44)
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40)
  return new Uint8Array(Buffer.concat([h, Buffer.from(pcm)]))
}

/** WAV tal cual si ya trae cabecera (Gemini 3.8); PCM sin cabecera (modelos anteriores) se envuelve. */
function asWav(raw: Uint8Array): Uint8Array {
  const riff = raw.length > 12 && raw[0] === 0x52 && raw[1] === 0x49 && raw[2] === 0x46 && raw[3] === 0x46
  return riff ? raw : pcmToWav(raw)
}

/**
 * Locución con la voz de Gemini (API de Gemini, la misma clave del estudio). Se usa para los reels sin personaje cuando no hay
 * una voz de ElevenLabs elegida. Modelo gemini-3.8-flash-tts (Interactions API); si falla, se prueba el 2.5 por generateContent.
 * Las etiquetas [..] de ElevenLabs no se envían: Gemini las leería en voz alta.
 */
export async function synthesizeGeminiSpeech(input: { text: string; voiceName?: string }, opts: { fetchImpl?: typeof fetch } = {}): Promise<{ bytes: Uint8Array }> {
  const key = await apiKeyFor("gemini")
  if (!key) throw new VoiceError("Conecta la API key de Gemini en Providers para generar la voz.", "no_key")
  const text = stripAudioTags(input.text).trim()
  if (!text) throw new VoiceError("No hay texto para la voz.", "invalid")
  const f = opts.fetchImpl ?? fetch
  const voice = input.voiceName || GEMINI_TTS_VOICE
  const base = "https://generativelanguage.googleapis.com/v1beta"
  let first = ""
  try {
    const res = await f(`${base}/interactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model: GEMINI_TTS_MODEL,
        input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: GEMINI_TTS_STYLE }] }] }],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice }] },
      }),
      signal: AbortSignal.timeout(90_000),
    })
    const body = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
    const j = JSON.parse(body) as { steps?: Array<{ content?: Array<{ type?: string; data?: string }> }> }
    const data = (j.steps ?? []).flatMap((st) => st.content ?? []).find((c) => c.data && (!c.type || c.type === "audio"))?.data
    if (!data) throw new Error("sin audio en la respuesta")
    const bytes = new Uint8Array(Buffer.from(data, "base64"))
    if (bytes.byteLength < 1000) throw new Error("audio vacío")
    return { bytes: asWav(bytes) }
  } catch (err) {
    first = err instanceof Error ? err.message : String(err)
    logger.warn(`[video-voice] ${GEMINI_TTS_MODEL} falló (${first.slice(0, 160)}); se prueba ${GEMINI_TTS_FALLBACK}`)
  }
  const res = await f(`${base}/models/${GEMINI_TTS_FALLBACK}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Di esto en español, con energía y ritmo de narrador de reels, marcando las palabras clave: ${text}` }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!res.ok) throw new VoiceError(`La voz de Gemini falló (${GEMINI_TTS_MODEL}: ${first.slice(0, 100)}; ${GEMINI_TTS_FALLBACK}: HTTP ${res.status})`)
  const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }> }
  const data = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data
  if (!data) throw new VoiceError("Gemini no devolvió audio para la voz.")
  return { bytes: asWav(new Uint8Array(Buffer.from(data, "base64"))) }
}
