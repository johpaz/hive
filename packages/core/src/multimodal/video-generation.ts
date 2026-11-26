/**
 * Generación de video para el estudio de reels.
 *
 * Usa Gemini Omni Flash por la API Interactions (`POST /v1beta/interactions`).
 * Veo 3.1 ya no existe en la Gemini API (apagado el 2026-10-22). La respuesta
 * llega completa en la misma llamada: el MP4 va en base64 dentro de
 * `steps[].content[]` con `type: "video"` (verificado con una llamada real).
 *
 * Es de pago: no hay capa gratuita. Cada clip cuesta por segundo y resolución,
 * por eso el estudio calcula un estimado y exige confirmación antes de gastar.
 */
import { logger } from "../utils/logger"
import { apiKeyFor, geminiHttpError, type ReferenceImage } from "./image-generation"

const log = logger.child("video-generation")

export const VIDEO_MODEL_ID = "gemini-omni-1.2-flash"
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta"
const REQUEST_TIMEOUT_MS = 300_000

export const VIDEO_ASPECT_RATIOS = ["9:16", "16:9"] as const
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number]

export const VIDEO_RESOLUTIONS = ["360p", "720p", "1080p", "4k"] as const
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number]

export const MIN_CLIP_SECONDS = 3
export const MAX_CLIP_SECONDS = 15
/** Con imagen de primer/último fotograma el modelo solo admite hasta 10 s. */
export const MAX_FRAME_CLIP_SECONDS = 10
export const MAX_VIDEO_REFERENCE_IMAGES = 6
const MAX_PROMPT_CHARS = 10_000

/** USD por segundo de video (precios documentados de Omni 1.2 Flash; la factura real manda). */
export const PRICE_PER_SECOND_USD: Record<VideoResolution, number> = {
  "360p": 0.023,
  "720p": 0.07,
  "1080p": 0.104,
  "4k": 0.209,
}
const OUTPUT_USD_PER_MILLION_TOKENS = 12
const INPUT_USD_PER_MILLION_TOKENS = 1.5

export class VideoGenerationError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message)
    this.name = "VideoGenerationError"
  }
}

export function clampClipSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_CLIP_SECONDS
  return Math.min(MAX_CLIP_SECONDS, Math.max(MIN_CLIP_SECONDS, Math.round(seconds)))
}

export function estimateClipCostUsd(resolution: VideoResolution, seconds: number): number {
  return round4(PRICE_PER_SECOND_USD[resolution] * clampClipSeconds(seconds))
}

/** Reparte una duración total en clips de hasta `maxClip` segundos, cada uno de al menos 3 s. */
export function splitDuration(totalSeconds: number, maxClip = MAX_CLIP_SECONDS): number[] {
  let remaining = Math.max(MIN_CLIP_SECONDS, Math.round(totalSeconds))
  const clips: number[] = []
  while (remaining > 0) {
    if (remaining <= maxClip) { clips.push(remaining); break }
    // Evita dejar un resto menor al mínimo de un clip.
    const take = remaining - maxClip < MIN_CLIP_SECONDS ? remaining - MIN_CLIP_SECONDS : maxClip
    clips.push(take)
    remaining -= take
  }
  return clips
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000

export interface GenerateVideoRequest {
  prompt: string
  aspectRatio?: VideoAspectRatio
  durationSeconds?: number
  resolution?: VideoResolution
  /** Imágenes de referencia o fotogramas de partida (imagen a video, personajes consistentes). */
  referenceImages?: ReferenceImage[]
  /** Continúa/edita un video anterior de la misma conversación de Omni. */
  previousInteractionId?: string
}

export interface GeneratedVideo {
  bytes: Uint8Array
  mimeType: string
  modelId: string
  interactionId: string | null
  durationSeconds: number
  resolution: VideoResolution
  aspectRatio: VideoAspectRatio
  /** Costo calculado con los tokens que reportó la API (más fiable que el estimado). */
  costUsd: number
}

interface InteractionResponse {
  id?: string
  status?: string
  usage?: { total_input_tokens?: number; total_output_tokens?: number }
  steps?: Array<{ type?: string; content?: Array<{ type?: string; mime_type?: string; data?: string; uri?: string }> }>
}

export function parseInteraction(json: InteractionResponse): { data: string | null; uri: string | null; mimeType: string } {
  for (const step of json.steps ?? []) {
    for (const part of step.content ?? []) {
      if (part.type === "video") return { data: part.data ?? null, uri: part.uri ?? null, mimeType: part.mime_type || "video/mp4" }
    }
  }
  return { data: null, uri: null, mimeType: "video/mp4" }
}

export async function generateVideoClip(
  req: GenerateVideoRequest,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GeneratedVideo> {
  const prompt = req.prompt?.trim()
  if (!prompt) throw new VideoGenerationError("Falta la descripción del clip.")
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new VideoGenerationError(`La descripción es demasiado larga (${prompt.length} caracteres; máximo ${MAX_PROMPT_CHARS}).`)
  }
  const aspectRatio = req.aspectRatio ?? "9:16"
  const resolution = req.resolution ?? "720p"
  const refs = (req.referenceImages ?? []).slice(0, MAX_VIDEO_REFERENCE_IMAGES)
  const maxSeconds = refs.length === 2 ? MAX_FRAME_CLIP_SECONDS : MAX_CLIP_SECONDS
  const durationSeconds = Math.min(maxSeconds, clampClipSeconds(req.durationSeconds ?? 8))

  const apiKey = await apiKeyFor("gemini")
  if (!apiKey) throw new VideoGenerationError("Falta la API key del provider Gemini.")

  const input: unknown = refs.length === 0
    ? prompt
    : [
        ...refs.map((img) => ({ type: "image", data: Buffer.from(img.bytes).toString("base64"), mime_type: img.mimeType })),
        { type: "text", text: prompt },
      ]
  const body: Record<string, unknown> = {
    model: VIDEO_MODEL_ID,
    input,
    response_format: { type: "video", aspect_ratio: aspectRatio, resolution, duration: `${durationSeconds}s` },
  }
  if (req.previousInteractionId) body.previous_interaction_id = req.previousInteractionId

  const fetchImpl = opts.fetchImpl ?? fetch
  const started = Date.now()
  let lastError: VideoGenerationError | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000))
    let res: Response
    try {
      res = await fetchImpl(`${GEMINI_API}/interactions`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (err) {
      const timeout = (err as Error).name === "TimeoutError"
      lastError = new VideoGenerationError(
        timeout ? "Gemini tardó demasiado en generar el clip." : `No se pudo contactar a Gemini: ${(err as Error).message}`, true)
      continue
    }
    const text = await res.text()
    if (!res.ok) {
      const e = geminiHttpError(res.status, text, "generar video")
      const err = new VideoGenerationError(e.message, e.retryable)
      if (!err.retryable) throw err
      lastError = err
      continue
    }
    let json: InteractionResponse
    try { json = JSON.parse(text) } catch { throw new VideoGenerationError("Gemini devolvió una respuesta que no es JSON.") }
    if (json.status && json.status !== "completed") {
      throw new VideoGenerationError(`Gemini no completó el clip (estado: ${json.status}).`)
    }
    const found = parseInteraction(json)
    let bytes: Uint8Array | null = found.data ? new Uint8Array(Buffer.from(found.data, "base64")) : null
    if (!bytes && found.uri) {
      const dl = await fetchImpl(found.uri, { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (!dl.ok) throw new VideoGenerationError(`No se pudo descargar el clip generado (HTTP ${dl.status}).`)
      bytes = new Uint8Array(await dl.arrayBuffer())
    }
    if (!bytes || bytes.byteLength < 1000) {
      throw new VideoGenerationError("Gemini no devolvió ningún video. Puede que el filtro de contenido bloqueara la descripción; prueba con otra.")
    }
    const outTokens = json.usage?.total_output_tokens ?? 0
    const inTokens = json.usage?.total_input_tokens ?? 0
    const costUsd = outTokens || inTokens
      ? round4((outTokens * OUTPUT_USD_PER_MILLION_TOKENS + inTokens * INPUT_USD_PER_MILLION_TOKENS) / 1_000_000)
      : estimateClipCostUsd(resolution, durationSeconds)
    log.info(`Clip generado (${durationSeconds}s ${resolution} ${aspectRatio}, ${bytes.byteLength} bytes, ${Date.now() - started} ms, ~${costUsd} USD)`)
    return {
      bytes, mimeType: found.mimeType, modelId: VIDEO_MODEL_ID, interactionId: json.id ?? null,
      durationSeconds, resolution, aspectRatio, costUsd,
    }
  }
  throw lastError ?? new VideoGenerationError("No se pudo generar el clip.")
}
