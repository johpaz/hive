/**
 * Generación de imágenes.
 *
 * Un solo modelo para todo el sistema (chat web, canales, agentes), elegido en
 * Providers → Imagen. Es independiente del modelo de chat: la tool
 * `image_generate` llama a ESTE modelo y entrega la imagen como artifact.
 *
 * Cada provider tiene su propio protocolo de imágenes, así que hay un adaptador
 * por provider. Hoy: NVIDIA, Gemini, OpenAI, OpenRouter, Qwen, Z.ai y MiniMax.
 *
 * Solo genera: los endpoints alojados de NVIDIA para editar (FLUX Kontext, FLUX.2
 * klein con imagen) aceptan únicamente imágenes de ejemplo predefinidas
 * (`data:image/png;example_id,N`), no fotos del usuario. Ver `docs/`.
 */
import { col } from "../storage/hive"
import type { ModelDoc } from "../storage/collections"
import { loadProviderApiKey } from "../storage/crypto"
import { wireModelId } from "../storage/model-id"
import { logger } from "../utils/logger"

const log = logger.child("image-generation")

const SETTINGS_COLLECTION = "system_settings"
const SETTING_ID = "image_model"
const MAX_PROMPT_CHARS = 10_000
const REQUEST_TIMEOUT_MS = 120_000

export const ASPECT_RATIOS = ["square", "landscape", "portrait", "4:3", "3:4"] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]

/** Tamaños que aceptan los modelos FLUX alojados (múltiplos de 64 entre 768 y 1344). */
const SIZES: Record<AspectRatio, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  landscape: { width: 1344, height: 768 },
  portrait: { width: 768, height: 1344 },
  "4:3": { width: 1152, height: 896 },
  "3:4": { width: 896, height: 1152 },
}

/** Relación de aspecto en el formato que piden los modelos de Gemini. */
const GEMINI_ASPECT: Record<AspectRatio, string> = {
  square: "1:1", landscape: "16:9", portrait: "9:16", "4:3": "4:3", "3:4": "3:4",
}

export interface ReferenceImage {
  bytes: Uint8Array
  mimeType: string
}

export interface GenerateImageRequest {
  prompt: string
  aspectRatio?: AspectRatio
  /**
   * Fija el modelo (fila de `models`) en vez de usar el elegido en Providers → Imagen.
   * El estudio de video lo usa para que Nano Banana no dependa de ese ajuste.
   */
  modelId?: string
  /** Imágenes de referencia (p. ej. el personaje de un reel). Solo Gemini las admite. */
  referenceImages?: ReferenceImage[]
}

export interface GeneratedImage {
  bytes: Uint8Array
  mimeType: string
  /** Fila de `models` que se usó. */
  modelId: string
  providerId: string
}

interface AdapterInput {
  apiKey: string
  /** El nombre que espera el provider en el cable, sin prefijo de revendedor. */
  wireModelId: string
  prompt: string
  size: { width: number; height: number }
  aspectRatio: AspectRatio
  referenceImages: ReferenceImage[]
  fetchImpl: typeof fetch
}

interface ImageAdapter {
  generate(input: AdapterInput): Promise<{ bytes: Uint8Array; mimeType: string }>
}

export class ImageGenerationError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message)
    this.name = "ImageGenerationError"
  }
}

function sniffMime(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg"
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp"
  return "image/png"
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ─── NVIDIA ──────────────────────────────────────────────────────────────────

const NVIDIA_GENAI = "https://ai.api.nvidia.com/v1/genai"

/**
 * Cuerpo por modelo. Los endpoints validan con `additionalProperties: false`:
 * un campo de más (p. ej. `seed`) devuelve 422, así que se envía lo mínimo.
 * Los dos modelos del catálogo son de pocos pasos (destilados): `steps: 4`.
 */
function nvidiaBody(wireId: string, input: AdapterInput): Record<string, unknown> {
  void wireId
  return { prompt: input.prompt, width: input.size.width, height: input.size.height, steps: 4 }
}

const nvidiaAdapter: ImageAdapter = {
  async generate(input) {
    const url = `${NVIDIA_GENAI}/${input.wireModelId}`
    let lastError: ImageGenerationError | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await delay(1500)
      let res: Response
      try {
        res = await input.fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(nvidiaBody(input.wireModelId, input)),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch (err) {
        const timeout = (err as Error).name === "TimeoutError"
        lastError = new ImageGenerationError(
          timeout ? "NVIDIA tardó demasiado en generar la imagen." : `No se pudo contactar a NVIDIA: ${(err as Error).message}`,
          true,
        )
        continue
      }

      if (res.status === 401 || res.status === 403) {
        throw new ImageGenerationError("NVIDIA rechazó la API key (revisa la clave del provider NVIDIA).")
      }
      if (res.status === 404) {
        throw new ImageGenerationError(`NVIDIA ya no ofrece el modelo ${input.wireModelId}. Elige otro en Providers → Imagen.`)
      }
      if (res.status === 429) {
        lastError = new ImageGenerationError("NVIDIA alcanzó el límite de solicitudes de la cuenta de prueba. Espera un momento.", true)
        continue
      }
      if (res.status >= 500) {
        lastError = new ImageGenerationError(`NVIDIA falló al generar la imagen (HTTP ${res.status}).`, true)
        continue
      }
      const text = await res.text()
      if (!res.ok) {
        let detail = text.slice(0, 200)
        try {
          const j = JSON.parse(text) as { detail?: unknown }
          detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail).slice(0, 200)
        } catch { /* texto plano */ }
        throw new ImageGenerationError(`NVIDIA rechazó la solicitud (HTTP ${res.status}): ${detail}`)
      }

      let json: { artifacts?: Array<{ base64?: string; finishReason?: string }> }
      try { json = JSON.parse(text) } catch { throw new ImageGenerationError("NVIDIA devolvió una respuesta que no es JSON.") }
      const artifact = json.artifacts?.[0]
      if (artifact?.finishReason && artifact.finishReason !== "SUCCESS") {
        throw new ImageGenerationError(
          artifact.finishReason === "CONTENT_FILTERED"
            ? "El filtro de contenido de NVIDIA bloqueó esta imagen. Prueba con otra descripción."
            : `NVIDIA no completó la imagen (${artifact.finishReason}).`,
        )
      }
      if (!artifact?.base64) throw new ImageGenerationError("NVIDIA no devolvió ninguna imagen.")
      const bytes = new Uint8Array(Buffer.from(artifact.base64.replace(/^data:[^,]+,/, ""), "base64"))
      if (bytes.byteLength < 100) throw new ImageGenerationError("NVIDIA devolvió una imagen vacía.")
      return { bytes, mimeType: sniffMime(bytes) }
    }
    throw lastError ?? new ImageGenerationError("No se pudo generar la imagen.")
  },
}

// ─── Gemini (Nano Banana) ────────────────────────────────────────────────────

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta"
const MAX_REFERENCE_IMAGES = 6

/** Traduce el error HTTP de la API de Gemini a un mensaje que el usuario pueda accionar. */
export function geminiHttpError(status: number, bodyText: string, what: string): ImageGenerationError {
  let apiMessage = ""
  try {
    const j = JSON.parse(bodyText) as { error?: { message?: string } } | Array<{ error?: { message?: string } }>
    apiMessage = (Array.isArray(j) ? j[0]?.error?.message : j.error?.message) ?? ""
  } catch { apiMessage = bodyText.slice(0, 200) }
  if (status === 402) {
    return new ImageGenerationError("Se agotó el saldo prepagado de la API de Gemini. Recarga en AI Studio → Billing para seguir generando.")
  }
  if (status === 401) {
    return new ImageGenerationError("Gemini rechazó la API key (revisa la clave del provider Gemini).")
  }
  if (status === 403) {
    // Se vio un ACCESS_DENIED intermitente que a la llamada siguiente se resolvía: se reintenta una vez.
    return new ImageGenerationError(`Gemini negó el acceso (403): ${apiMessage.slice(0, 160) || "revisa la clave y los permisos del proyecto"}.`, true)
  }
  if (status === 429) {
    const freeTier = /free_tier|free tier/i.test(apiMessage)
    return new ImageGenerationError(
      freeTier
        ? `La clave de Gemini está en capa gratuita y ${what} requiere facturación. Activa el prepago en AI Studio → Billing.`
        : "Gemini alcanzó el límite de solicitudes. Espera un momento e inténtalo de nuevo.",
      !freeTier,
    )
  }
  if (status >= 500) return new ImageGenerationError(`Gemini falló al generar (HTTP ${status}).`, true)
  return new ImageGenerationError(`Gemini rechazó la solicitud (HTTP ${status}): ${apiMessage.slice(0, 200)}`)
}

const geminiAdapter: ImageAdapter = {
  async generate(input) {
    const parts: Array<Record<string, unknown>> = input.referenceImages
      .slice(0, MAX_REFERENCE_IMAGES)
      .map((img) => ({ inlineData: { mimeType: img.mimeType, data: Buffer.from(img.bytes).toString("base64") } }))
    parts.push({ text: input.prompt })
    const body = {
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: GEMINI_ASPECT[input.aspectRatio] },
      },
    }
    let lastError: ImageGenerationError | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await delay(2000)
      let res: Response
      try {
        res = await input.fetchImpl(`${GEMINI_API}/models/${input.wireModelId}:generateContent`, {
          method: "POST",
          headers: { "x-goog-api-key": input.apiKey, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch (err) {
        const timeout = (err as Error).name === "TimeoutError"
        lastError = new ImageGenerationError(
          timeout ? "Gemini tardó demasiado en generar la imagen." : `No se pudo contactar a Gemini: ${(err as Error).message}`, true)
        continue
      }
      const text = await res.text()
      if (!res.ok) {
        const err = geminiHttpError(res.status, text, "generar imágenes")
        if (!err.retryable) throw err
        lastError = err
        continue
      }
      let json: {
        candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>
        promptFeedback?: { blockReason?: string }
      }
      try { json = JSON.parse(text) } catch { throw new ImageGenerationError("Gemini devolvió una respuesta que no es JSON.") }
      if (json.promptFeedback?.blockReason) {
        throw new ImageGenerationError("El filtro de contenido de Gemini bloqueó esta imagen. Prueba con otra descripción.")
      }
      const candidate = json.candidates?.[0]
      const data = candidate?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data
      if (!data) {
        const reason = candidate?.finishReason
        throw new ImageGenerationError(
          reason && /SAFETY|PROHIBITED|BLOCK/i.test(reason)
            ? "El filtro de contenido de Gemini bloqueó esta imagen. Prueba con otra descripción."
            : `Gemini no devolvió ninguna imagen${reason ? ` (${reason})` : ""}.`,
        )
      }
      const bytes = new Uint8Array(Buffer.from(data, "base64"))
      if (bytes.byteLength < 100) throw new ImageGenerationError("Gemini devolvió una imagen vacía.")
      return { bytes, mimeType: sniffMime(bytes) }
    }
    throw lastError ?? new ImageGenerationError("No se pudo generar la imagen.")
  },
}

// ─── OpenAI (gpt-image) ──────────────────────────────────────────────────────

const OPENAI_API = "https://api.openai.com/v1"

/** gpt-image solo admite estos tres tamaños. */
const OPENAI_SIZE: Record<AspectRatio, string> = {
  square: "1024x1024", landscape: "1536x1024", portrait: "1024x1536", "4:3": "1536x1024", "3:4": "1024x1536",
}

/** Error HTTP de un provider OpenAI-compatible → mensaje accionable. */
function compatHttpError(name: string, status: number, bodyText: string): ImageGenerationError {
  let msg = ""
  try {
    const j = JSON.parse(bodyText) as { error?: { message?: string } | string }
    msg = typeof j.error === "string" ? j.error : j.error?.message ?? ""
  } catch { msg = bodyText.slice(0, 200) }
  if (status === 401) return new ImageGenerationError(`${name} rechazó la API key (revisa la clave del provider).`)
  if (status === 402) return new ImageGenerationError(`${name}: saldo insuficiente. Recarga créditos para seguir generando.`)
  if (status === 429) return new ImageGenerationError(`${name} alcanzó el límite de solicitudes. Espera un momento e inténtalo de nuevo.`, true)
  if (status >= 500) return new ImageGenerationError(`${name} falló al generar (HTTP ${status}).`, true)
  return new ImageGenerationError(`${name} rechazó la solicitud (HTTP ${status}): ${msg.slice(0, 200)}`)
}

/** Ejecuta `doFetch` con un reintento en errores transitorios y timeouts. */
async function withRetry(name: string, doFetch: () => Promise<Response>): Promise<string> {
  let lastError: ImageGenerationError | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await delay(2000)
    let res: Response
    try {
      res = await doFetch()
    } catch (err) {
      const timeout = (err as Error).name === "TimeoutError"
      lastError = new ImageGenerationError(
        timeout ? `${name} tardó demasiado en generar la imagen.` : `No se pudo contactar a ${name}: ${(err as Error).message}`, true)
      continue
    }
    const text = await res.text()
    if (res.ok) return text
    const err = compatHttpError(name, res.status, text)
    if (!err.retryable) throw err
    lastError = err
  }
  throw lastError ?? new ImageGenerationError("No se pudo generar la imagen.")
}

function decodeImage(name: string, b64: string | undefined): { bytes: Uint8Array; mimeType: string } {
  if (!b64) throw new ImageGenerationError(`${name} no devolvió ninguna imagen.`)
  const bytes = new Uint8Array(Buffer.from(b64.replace(/^data:[^,]+,/, ""), "base64"))
  if (bytes.byteLength < 100) throw new ImageGenerationError(`${name} devolvió una imagen vacía.`)
  return { bytes, mimeType: sniffMime(bytes) }
}

const openaiAdapter: ImageAdapter = {
  async generate(input) {
    const refs = input.referenceImages.slice(0, MAX_REFERENCE_IMAGES)
    const size = OPENAI_SIZE[input.aspectRatio]
    const text = await withRetry("OpenAI", () => {
      if (refs.length === 0) {
        return input.fetchImpl(`${OPENAI_API}/images/generations`, {
          method: "POST",
          headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: input.wireModelId, prompt: input.prompt, size, n: 1 }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      }
      const form = new FormData()
      form.set("model", input.wireModelId)
      form.set("prompt", input.prompt)
      form.set("size", size)
      for (const [i, img] of refs.entries()) {
        form.append("image[]", new Blob([img.bytes as BlobPart], { type: img.mimeType }), `ref-${i}.${img.mimeType.split("/")[1] ?? "png"}`)
      }
      return input.fetchImpl(`${OPENAI_API}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    })
    let json: { data?: Array<{ b64_json?: string }> }
    try { json = JSON.parse(text) } catch { throw new ImageGenerationError("OpenAI devolvió una respuesta que no es JSON.") }
    return decodeImage("OpenAI", json.data?.[0]?.b64_json)
  },
}

// ─── OpenRouter (modelos con salida de imagen vía chat/completions) ──────────

const OPENROUTER_API = "https://openrouter.ai/api/v1"

const openrouterAdapter: ImageAdapter = {
  async generate(input) {
    const refs = input.referenceImages.slice(0, MAX_REFERENCE_IMAGES)
    const content: unknown = refs.length === 0
      ? input.prompt
      : [
          ...refs.map((img) => ({
            type: "image_url",
            image_url: { url: `data:${img.mimeType};base64,${Buffer.from(img.bytes).toString("base64")}` },
          })),
          { type: "text", text: input.prompt },
        ]
    const text = await withRetry("OpenRouter", () =>
      input.fetchImpl(`${OPENROUTER_API}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.wireModelId,
          messages: [{ role: "user", content }],
          modalities: ["image", "text"],
          image_config: { aspect_ratio: GEMINI_ASPECT[input.aspectRatio] },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    )
    let json: { choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>; error?: { message?: string } }
    try { json = JSON.parse(text) } catch { throw new ImageGenerationError("OpenRouter devolvió una respuesta que no es JSON.") }
    if (json.error?.message) throw new ImageGenerationError(`OpenRouter: ${json.error.message.slice(0, 200)}`)
    return decodeImage("OpenRouter", json.choices?.[0]?.message?.images?.[0]?.image_url?.url)
  },
}

// ─── Descarga de imágenes devueltas como URL (Qwen, Z.ai) ────────────────────

async function downloadImage(name: string, url: string | undefined, fetchImpl: typeof fetch): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (!url) throw new ImageGenerationError(`${name} no devolvió ninguna imagen.`)
  if (!/^https:\/\//i.test(url)) throw new ImageGenerationError(`${name} devolvió una URL de imagen no válida.`)
  let res: Response
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (err) {
    throw new ImageGenerationError(`No se pudo descargar la imagen de ${name}: ${(err as Error).message}`, true)
  }
  if (!res.ok) throw new ImageGenerationError(`No se pudo descargar la imagen de ${name} (HTTP ${res.status}).`, true)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength < 100) throw new ImageGenerationError(`${name} devolvió una imagen vacía.`)
  return { bytes, mimeType: sniffMime(bytes) }
}

// ─── Qwen-Image (Alibaba DashScope, región internacional) ────────────────────

const QWEN_API = "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"

/** "ancho*alto"; entre 512*512 y 2048*2048 píxeles en total. */
const QWEN_SIZE: Record<AspectRatio, string> = {
  square: "1024*1024", landscape: "2688*1536", portrait: "1536*2688", "4:3": "2368*1728", "3:4": "1728*2368",
}

const qwenAdapter: ImageAdapter = {
  async generate(input) {
    const text = await withRetry("Qwen", () =>
      input.fetchImpl(QWEN_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.wireModelId,
          input: { messages: [{ role: "user", content: [{ text: input.prompt }] }] },
          parameters: { size: QWEN_SIZE[input.aspectRatio], n: 1, watermark: false },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    )
    let json: { output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> }; message?: string }
    try { json = JSON.parse(text) } catch { throw new ImageGenerationError("Qwen devolvió una respuesta que no es JSON.") }
    const url = json.output?.choices?.[0]?.message?.content?.find((c) => c.image)?.image
    // La URL caduca en 24 h: se descarga ya para guardarla como artifact.
    return downloadImage("Qwen", url, input.fetchImpl)
  },
}

// ─── Z.ai (GLM-Image) ────────────────────────────────────────────────────────

const ZAI_API = "https://api.z.ai/api/paas/v4/images/generations"

const ZAI_SIZE: Record<AspectRatio, string> = {
  square: "1280x1280", landscape: "1728x960", portrait: "960x1728", "4:3": "1472x1088", "3:4": "1088x1472",
}

const zaiAdapter: ImageAdapter = {
  async generate(input) {
    const text = await withRetry("Z.ai", () =>
      input.fetchImpl(ZAI_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: input.wireModelId, prompt: input.prompt, size: ZAI_SIZE[input.aspectRatio] }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    )
    let json: { data?: Array<{ url?: string }>; message?: string }
    try { json = JSON.parse(text) } catch { throw new ImageGenerationError("Z.ai devolvió una respuesta que no es JSON.") }
    return downloadImage("Z.ai", json.data?.[0]?.url, input.fetchImpl)
  },
}

// ─── MiniMax (image-01) ──────────────────────────────────────────────────────

const MINIMAX_API = "https://api.minimax.io/v1/image_generation"

const minimaxAdapter: ImageAdapter = {
  async generate(input) {
    const text = await withRetry("MiniMax", () =>
      input.fetchImpl(MINIMAX_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.wireModelId,
          prompt: input.prompt.slice(0, 1500),
          aspect_ratio: GEMINI_ASPECT[input.aspectRatio],
          response_format: "base64",
          n: 1,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
    )
    let json: { data?: { image_base64?: string[] }; base_resp?: { status_code?: number; status_msg?: string } }
    try { json = JSON.parse(text) } catch { throw new ImageGenerationError("MiniMax devolvió una respuesta que no es JSON.") }
    // MiniMax responde HTTP 200 aun con error: el resultado va en base_resp.
    const code = json.base_resp?.status_code ?? 0
    if (code !== 0) {
      const friendly: Record<number, string> = {
        1002: "MiniMax alcanzó el límite de solicitudes. Espera un momento e inténtalo de nuevo.",
        1004: "MiniMax rechazó la API key (revisa la clave del provider).",
        2049: "MiniMax rechazó la API key (revisa la clave del provider).",
        1008: "MiniMax: saldo insuficiente. Recarga créditos para seguir generando.",
        1026: "El filtro de contenido de MiniMax bloqueó esta imagen. Prueba con otra descripción.",
      }
      throw new ImageGenerationError(friendly[code] ?? `MiniMax rechazó la solicitud (${code}): ${json.base_resp?.status_msg ?? ""}`.trim(), code === 1002)
    }
    return decodeImage("MiniMax", json.data?.image_base64?.[0])
  },
}

/** Providers con adaptador: solo ellos pueden ser el generador de imágenes. */
const ADAPTERS: Record<string, ImageAdapter> = {
  nvidia: nvidiaAdapter,
  gemini: geminiAdapter,
  openai: openaiAdapter,
  openrouter: openrouterAdapter,
  qwen: qwenAdapter,
  "z-ai": zaiAdapter,
  minimax: minimaxAdapter,
}

export function supportsImageGeneration(providerId: string): boolean {
  return providerId in ADAPTERS
}

// ─── Ajuste del sistema ──────────────────────────────────────────────────────

export async function apiKeyFor(providerId: string): Promise<string> {
  const raw = (await loadProviderApiKey(providerId)) || process.env[`${providerId.toUpperCase()}_API_KEY`] || ""
  // Un pegado suele arrastrar espacios, saltos de línea o comillas: la API respondería «clave inválida».
  return raw.trim().replace(/^["'`]+|["'`]+$/g, "").trim()
}

export async function getImageModelId(): Promise<string | null> {
  const entry = await (await col<{ model_id: string | null }>(SETTINGS_COLLECTION)).get(SETTING_ID)
  return entry?.doc.model_id || null
}

/** Guarda el modelo generador (null lo quita). Valida tipo, adaptador y API key. */
export async function setImageModelId(modelId: string | null): Promise<void> {
  if (modelId) {
    const entry = await (await col<ModelDoc>("models")).get(modelId)
    if (!entry) throw new Error(`El modelo ${modelId} no existe`)
    if (entry.doc.model_type !== "image") throw new Error(`${entry.doc.name} no es un modelo de generación de imágenes`)
    if (!supportsImageGeneration(entry.doc.provider_id)) {
      throw new Error(`Hive todavía no sabe generar imágenes con el provider ${entry.doc.provider_id}`)
    }
    if (!(await apiKeyFor(entry.doc.provider_id))) {
      throw new Error(`Primero configura la API key del provider ${entry.doc.provider_id}`)
    }
  }
  const settings = await col<{ model_id: string | null }>(SETTINGS_COLLECTION)
  const current = await settings.get(SETTING_ID)
  await settings.put(SETTING_ID, { model_id: modelId }, { expectedVersion: current?.version ?? 0 })
}

// ─── Generación ──────────────────────────────────────────────────────────────

export class ImageModelNotConfiguredError extends Error {
  constructor() {
    super("No hay un modelo de generación de imágenes configurado.")
    this.name = "ImageModelNotConfiguredError"
  }
}

export async function generateImage(
  req: GenerateImageRequest,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<GeneratedImage> {
  const prompt = req.prompt?.trim()
  if (!prompt) throw new ImageGenerationError("Falta la descripción de la imagen.")
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new ImageGenerationError(`La descripción es demasiado larga (${prompt.length} caracteres; máximo ${MAX_PROMPT_CHARS}).`)
  }

  const modelId = req.modelId ?? (await getImageModelId())
  if (!modelId) throw new ImageModelNotConfiguredError()
  const entry = await (await col<ModelDoc>("models")).get(modelId)
  if (!entry) throw new ImageGenerationError(`El modelo de imágenes ${modelId} ya no existe. Elige otro en Providers → Imagen.`)

  const providerId = entry.doc.provider_id
  const adapter = ADAPTERS[providerId]
  if (!adapter) throw new ImageGenerationError(`Hive todavía no sabe generar imágenes con el provider ${providerId}.`)
  const apiKey = await apiKeyFor(providerId)
  if (!apiKey) throw new ImageGenerationError(`Falta la API key del provider ${providerId}.`)

  const started = Date.now()
  const out = await adapter.generate({
    apiKey,
    wireModelId: wireModelId(providerId, modelId),
    prompt,
    size: SIZES[req.aspectRatio ?? "square"] ?? SIZES.square,
    aspectRatio: req.aspectRatio ?? "square",
    referenceImages: req.referenceImages ?? [],
    fetchImpl: opts.fetchImpl ?? fetch,
  })
  log.info(`Imagen generada con ${providerId}/${modelId} (${out.bytes.byteLength} bytes, ${Date.now() - started} ms)`)
  return { ...out, modelId, providerId }
}
