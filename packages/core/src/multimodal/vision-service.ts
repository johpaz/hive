import { col } from "../storage/hive"
import type { ChannelDoc, ModelDoc, ProviderDoc } from "../storage/collections"
import { loadProviderApiKey } from "../storage/crypto"
import { logger } from "../utils/logger"
import type { ImageInput, DocumentInput, VisionConfig } from "./types"
import type { ContentPart } from "./types"

const log = logger.child("multimodal")

class MultimodalService {
  private static instance: MultimodalService

  private constructor() {}

  static getInstance(): MultimodalService {
    if (!MultimodalService.instance) {
      MultimodalService.instance = new MultimodalService()
    }
    return MultimodalService.instance
  }

  async getChannelVisionConfig(channelId: string): Promise<VisionConfig> {
    const channelsCol = await col<ChannelDoc>("channels")
    const entry = await channelsCol.get(channelId)

    if (!entry) {
      return { visionEnabled: false, ocrProvider: null, visionProvider: null, visionModelId: null }
    }

    return {
      visionEnabled: entry.doc.vision_enabled,
      ocrProvider: entry.doc.ocr_provider,
      visionProvider: entry.doc.vision_provider,
      visionModelId: entry.doc.vision_model_id,
    }
  }

  async processImage(image: ImageInput, visionModelId?: string): Promise<ContentPart[]> {
    const parts: ContentPart[] = []

    if (image.caption) {
      parts.push({ type: "text", text: image.caption })
    }

    if (image.type === "url") {
      parts.push({ type: "image_url", image_url: { url: image.data as string } })
    } else if (image.type === "base64") {
      parts.push({
        type: "image_base64",
        base64: image.data as string,
        mimeType: image.mimeType || "image/jpeg",
      })
    } else if (image.type === "buffer") {
      const base64 = Buffer.from(image.data as Buffer).toString("base64")
      parts.push({
        type: "image_base64",
        base64,
        mimeType: image.mimeType || "image/jpeg",
      })
    }

    return parts
  }

  async ocrImage(image: ImageInput, providerId?: string): Promise<string> {
    const resolved = providerId || "openai"

    if (resolved === "openai") {
      return this.ocrWithOpenAI(image)
    } else if (resolved === "gemini") {
      return this.ocrWithGemini(image)
    } else if (resolved === "anthropic") {
      return this.ocrWithAnthropic(image)
    }

    log.warn(`Unknown OCR provider ${resolved}, defaulting to OpenAI`)
    return this.ocrWithOpenAI(image)
  }

  normalizeImageFromChannel(channelType: string, imageData: unknown): ImageInput {
    const data = imageData as { url?: string; base64?: string; buffer?: Buffer; mimeType?: string; caption?: string }

    if (data.url) {
      return { type: "url", data: data.url, mimeType: data.mimeType, caption: data.caption }
    }
    if (data.base64) {
      return { type: "base64", data: data.base64, mimeType: data.mimeType || "image/jpeg", caption: data.caption }
    }
    if (data.buffer) {
      return { type: "buffer", data: data.buffer, mimeType: data.mimeType || "image/jpeg", caption: data.caption }
    }

    throw new Error(`${channelType} image missing url, base64, or buffer`)
  }

  normalizeDocumentFromChannel(channelType: string, docData: unknown): DocumentInput {
    const data = docData as { url?: string; base64?: string; buffer?: Buffer; mimeType?: string; fileName?: string }

    if (data.url) {
      return { type: "url", data: data.url, mimeType: data.mimeType || "application/pdf", fileName: data.fileName }
    }
    if (data.base64) {
      return { type: "base64", data: data.base64, mimeType: data.mimeType || "application/pdf", fileName: data.fileName }
    }
    if (data.buffer) {
      return { type: "buffer", data: data.buffer, mimeType: data.mimeType || "application/pdf", fileName: data.fileName }
    }

    throw new Error(`${channelType} document missing url, base64, or buffer`)
  }

  async resolveImageUrl(image: ImageInput): Promise<string> {
    if (image.type === "url") return image.data as string
    if (image.type === "base64") {
      const mime = image.mimeType || "image/jpeg"
      return `data:${mime};base64,${image.data as string}`
    }
    if (image.type === "buffer") {
      const base64 = Buffer.from(image.data as Buffer).toString("base64")
      const mime = image.mimeType || "image/jpeg"
      return `data:${mime};base64,${base64}`
    }
    throw new Error("Cannot resolve image URL")
  }

  private async getProviderApiKey(providerId: string): Promise<string | null> {
    const apiKey = await loadProviderApiKey(providerId)
    return apiKey || null
  }

  /** Modelo con capacidad de visión del provider según la BD; el literal queda como último recurso. */
  private async getVisionModel(providerId: string, fallback: string): Promise<string> {
    try {
      const modelsCol = await col<ModelDoc>("models")
      const models = await modelsCol.findBy("provider_id", providerId)
      const candidates = models.filter(e =>
        e.doc.model_type === "llm" &&
        (e.doc.capabilities?.includes('"vision"') || e.doc.capabilities?.includes('"ocr"'))
      )
      const best = [...candidates].sort((a, b) => Number(b.doc.active) - Number(a.doc.active))[0]
      return best?.doc.id || fallback
    } catch {
      return fallback
    }
  }

  private async ocrWithOpenAI(image: ImageInput): Promise<string> {
    const key = await this.getProviderApiKey("openai") || process.env.OPENAI_API_KEY
    if (!key) throw new Error("OPENAI_API_KEY not configured for OCR")

    const imageUrl = await this.resolveImageUrl(image)

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({
        model: await this.getVisionModel("openai", "gpt-4o-mini"),
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Describe el contenido de esta imagen en detalle. Si hay texto, transcríbelo exactamente." },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        }],
        max_tokens: 1000,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI OCR failed: ${error}`)
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> }
    return data.choices[0]?.message?.content || ""
  }

  private async ocrWithGemini(image: ImageInput): Promise<string> {
    const key = await this.getProviderApiKey("gemini") || process.env.GEMINI_API_KEY
    if (!key) throw new Error("GEMINI_API_KEY not configured for OCR")

    let imagePart: any
    if (image.type === "url") {
      const imgResponse = await fetch(image.data as string)
      const buffer = Buffer.from(await imgResponse.arrayBuffer())
      imagePart = { inlineData: { data: buffer.toString("base64"), mimeType: image.mimeType || "image/jpeg" } }
    } else if (image.type === "base64") {
      imagePart = { inlineData: { data: image.data as string, mimeType: image.mimeType || "image/jpeg" } }
    } else {
      imagePart = { inlineData: { data: Buffer.from(image.data as Buffer).toString("base64"), mimeType: image.mimeType || "image/jpeg" } }
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${await this.getVisionModel("gemini", "gemini-2.0-flash")}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Describe el contenido de esta imagen en detalle. Si hay texto, transcríbelo exactamente." }, imagePart] }],
        }),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Gemini OCR failed: ${error}`)
    }

    const data = await response.json() as { candidates: Array<{ content: { parts: Array<{ text?: string }> } }> }
    return data.candidates?.[0]?.content?.parts?.[0]?.text || ""
  }

  private async ocrWithAnthropic(image: ImageInput): Promise<string> {
    const key = await this.getProviderApiKey("anthropic") || process.env.ANTHROPIC_API_KEY
    if (!key) throw new Error("ANTHROPIC_API_KEY not configured for OCR")

    const imageUrl = await this.resolveImageUrl(image)

    let source: any
    if (imageUrl.startsWith("data:")) {
      const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/)
      if (match) {
        source = { type: "base64", media_type: match[1], data: match[2] }
      } else {
        throw new Error("Invalid base64 data URL")
      }
    } else {
      source = { type: "url", url: imageUrl }
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: await this.getVisionModel("anthropic", "claude-haiku-4-5-20251001"),
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source },
            { type: "text", text: "Describe el contenido de esta imagen en detalle. Si hay texto, transcríbelo exactamente." },
          ],
        }],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Anthropic OCR failed: ${error}`)
    }

    const data = await response.json() as { content: Array<{ type: string; text?: string }> }
    const textBlock = data.content?.find(b => b.type === "text" && b.text)
    return textBlock?.text || ""
  }

  async getConfiguredVisionProviders(): Promise<Record<string, boolean>> {
    const hasDbKey = async (providerId: string): Promise<boolean> => !!(await loadProviderApiKey(providerId))

    const [openai, gemini, anthropic] = await Promise.all([
      hasDbKey("openai"), hasDbKey("gemini"), hasDbKey("anthropic"),
    ])

    return {
      openai: openai || !!(process.env.OPENAI_API_KEY),
      gemini: gemini || !!(process.env.GEMINI_API_KEY),
      anthropic: anthropic || !!(process.env.ANTHROPIC_API_KEY),
    }
  }

  async modelSupportsVision(providerId: string, modelId: string): Promise<boolean> {
    const modelsCol = await col<ModelDoc>("models")
    const entry = await modelsCol.get(modelId)
    if (!entry || entry.doc.provider_id !== providerId || !entry.doc.capabilities) return false
    try {
      const caps = JSON.parse(entry.doc.capabilities) as string[]
      return caps.includes("vision")
    } catch {
      return false
    }
  }
}

export const multimodalService = MultimodalService.getInstance()
