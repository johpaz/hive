/**
 * Generación de imágenes.
 *
 * Un solo modelo para todo el sistema (chat web, canales, agentes), elegido en
 * Providers → Imagen. Es independiente del modelo de chat: la tool
 * `image_generate` llama a ESTE modelo y entrega la imagen como artifact.
 *
 * Cada provider tiene su propio protocolo de imágenes, así que hay un adaptador
 * por provider. Hoy: NVIDIA (endpoints `ai.api.nvidia.com/v1/genai/...`).
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

export interface GenerateImageRequest {
  prompt: string
  aspectRatio?: AspectRatio
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

/** Providers con adaptador: solo ellos pueden ser el generador de imágenes. */
const ADAPTERS: Record<string, ImageAdapter> = {
  nvidia: nvidiaAdapter,
}

export function supportsImageGeneration(providerId: string): boolean {
  return providerId in ADAPTERS
}

// ─── Ajuste del sistema ──────────────────────────────────────────────────────

async function apiKeyFor(providerId: string): Promise<string> {
  return (await loadProviderApiKey(providerId)) || process.env[`${providerId.toUpperCase()}_API_KEY`] || ""
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

  const modelId = await getImageModelId()
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
    fetchImpl: opts.fetchImpl ?? fetch,
  })
  log.info(`Imagen generada con ${providerId}/${modelId} (${out.bytes.byteLength} bytes, ${Date.now() - started} ms)`)
  return { ...out, modelId, providerId }
}
