/**
 * Modelo analizador de imágenes del sistema.
 *
 * Es independiente del modelo de chat: cuando el modelo del agente no ve
 * imágenes (o hay que leer un adjunto), se le pide a ESTE modelo que describa y
 * transcriba la imagen, y el agente recibe el texto. Un solo modelo para todos
 * los canales, elegido en la pestaña Imagen de Providers.
 */
import { col } from "../storage/hive"
import type { ModelDoc } from "../storage/collections"
import { logger } from "../utils/logger"
import type { ImageInput } from "./types"

const log = logger.child("vision-analyzer")

const SETTINGS_COLLECTION = "system_settings"
const SETTING_ID = "vision_analyzer"
const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif)$/i

export const ANALYZER_PROMPT =
  "Describe el contenido de esta imagen en detalle. Si hay texto, tablas o números, transcríbelos exactamente. " +
  "Si es un documento, un recibo o una captura de pantalla, resume su estructura y lo importante."

function hasVision(model: ModelDoc): boolean {
  try { return (JSON.parse(model.capabilities || "[]") as string[]).includes("vision") } catch { return false }
}

export async function getVisionAnalyzerModelId(): Promise<string | null> {
  const entry = await (await col<{ model_id: string | null }>(SETTINGS_COLLECTION)).get(SETTING_ID)
  return entry?.doc.model_id || null
}

/** Guarda el modelo analizador (null lo quita). Solo acepta modelos LLM con visión. */
export async function setVisionAnalyzerModelId(modelId: string | null): Promise<void> {
  if (modelId) {
    const entry = await (await col<ModelDoc>("models")).get(modelId)
    if (!entry) throw new Error(`El modelo ${modelId} no existe`)
    if (entry.doc.model_type !== "llm" || !hasVision(entry.doc)) {
      throw new Error(`El modelo ${entry.doc.name} no tiene capacidad de visión`)
    }
  }
  const settings = await col<{ model_id: string | null }>(SETTINGS_COLLECTION)
  const current = await settings.get(SETTING_ID)
  await settings.put(SETTING_ID, { model_id: modelId }, { expectedVersion: current?.version ?? 0 })
}

async function toDataUrl(image: ImageInput): Promise<string | null> {
  const mime = image.mimeType || "image/jpeg"
  if (!IMAGE_MIME.test(mime)) return null // PDF y otros formatos: los atiende el OCR de siempre
  if (image.type === "url") return image.data as string
  const base64 = image.type === "buffer" ? Buffer.from(image.data as Buffer).toString("base64") : (image.data as string)
  return `data:${mime};base64,${base64}`
}

/**
 * Describe la imagen con el modelo analizador. Devuelve null si no hay modelo
 * configurado o la entrada no es una imagen (el llamador usa su respaldo);
 * lanza si el modelo configurado falla, para que el fallo quede en el log.
 */
export async function analyzeImage(image: ImageInput): Promise<string | null> {
  const modelId = await getVisionAnalyzerModelId()
  if (!modelId) return null
  const url = await toDataUrl(image)
  if (!url) return null

  const entry = await (await col<ModelDoc>("models")).get(modelId)
  if (!entry) throw new Error(`El modelo analizador ${modelId} ya no existe`)

  const { callLLM, resolveProviderConfig, LLM_ERROR_PREFIX } = await import("../agent/llm-client")
  const cfg = await resolveProviderConfig(entry.doc.provider_id, modelId)
  if (!cfg.apiKey && entry.doc.provider_id !== "ollama") {
    throw new Error(`Falta la API key de ${entry.doc.provider_id} para el modelo analizador`)
  }
  const res = await callLLM({
    ...cfg,
    // La clave tal cual: el adaptador del provider ya quita su propio prefijo al armar el request.
    // Quitarlo aquí también lo recortaba dos veces (nvidia/nvidia/x → x) y daba 404.
    model: modelId,
    maxTokens: 2000,
    temperature: 0.1,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: image.caption ? `${ANALYZER_PROMPT}\nContexto del usuario: ${image.caption}` : ANALYZER_PROMPT },
        { type: "image_url", image_url: { url } },
      ],
    }],
  })
  if (res.stop_reason === "error" || res.content.startsWith(LLM_ERROR_PREFIX)) {
    throw new Error(res.content.replace(LLM_ERROR_PREFIX, "").trim() || "el modelo analizador falló")
  }
  log.info(`Imagen analizada con ${entry.doc.provider_id}/${modelId} (${res.content.length} caracteres)`)
  return res.content
}
