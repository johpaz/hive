import { multimodalService } from "../../multimodal/index"
import { col, updateDoc } from "../../storage/hive"
import type { ModelDoc, ProviderDoc, ChannelDoc } from "../../storage/collections"
import { loadProviderApiKey } from "../../storage/crypto"

export async function handleGetVisionProviders(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const configured = await multimodalService.getConfiguredVisionProviders()
  const modelsCol = await col<ModelDoc>("models")
  const providersCol = await col<ProviderDoc>("providers")

  const enabledModels = (await modelsCol.scan({})).filter(e => e.doc.enabled)
  const visionModels: Array<{ id: string; name: string; provider_id: string }> = []
  for (const m of enabledModels) {
    const provider = await providersCol.get(m.doc.provider_id)
    if (!provider?.doc.enabled) continue
    const apiKey = await loadProviderApiKey(m.doc.provider_id)
    if (!apiKey) continue
    try {
      const caps = JSON.parse(m.doc.capabilities || "[]") as string[]
      if (caps.includes("vision")) {
        visionModels.push({ id: m.doc.id, name: m.doc.name, provider_id: m.doc.provider_id })
      }
    } catch { /* skip malformed capabilities */ }
  }

  return addCorsHeaders(Response.json({
    configuredProviders: configured,
    visionModels: visionModels.map(m => ({
      id: m.id,
      name: m.name,
      providerId: m.provider_id,
    })),
  }), req)
}

export async function handleGetChannelVision(req: Request, addCorsHeaders: (r: Response, req: Request) => Response, channelId: string): Promise<Response> {
  const config = await multimodalService.getChannelVisionConfig(channelId)
  return addCorsHeaders(Response.json(config), req)
}

export async function handleUpdateChannelVision(req: Request, addCorsHeaders: (r: Response, req: Request) => Response, channelId: string): Promise<Response> {
  const body = await req.json().catch(() => ({})) as {
    visionEnabled?: boolean
    ocrProvider?: string
    visionProvider?: string
    visionModelId?: string
  }

  const patch: Partial<ChannelDoc> = {}
  if (body.visionEnabled !== undefined) patch.vision_enabled = !!body.visionEnabled
  if (body.ocrProvider !== undefined) patch.ocr_provider = body.ocrProvider
  if (body.visionProvider !== undefined) patch.vision_provider = body.visionProvider
  if (body.visionModelId !== undefined) patch.vision_model_id = body.visionModelId

  if (Object.keys(patch).length === 0) {
    return addCorsHeaders(Response.json({ success: false, error: "No fields to update" }, { status: 400 }), req)
  }

  await updateDoc<ChannelDoc>("channels", channelId, patch).catch(() => { /* not found */ })

  const updated = await multimodalService.getChannelVisionConfig(channelId)
  return addCorsHeaders(Response.json({ success: true, config: updated }), req)
}

export async function handleOcrImage(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({})) as {
    image?: { url?: string; base64?: string; buffer?: string; mimeType?: string; caption?: string }
    provider?: string
  }

  if (!body.image) {
    return addCorsHeaders(Response.json({ success: false, error: "image required" }, { status: 400 }), req)
  }

  try {
    const imageInput = multimodalService.normalizeImageFromChannel("api", body.image)
    const text = await multimodalService.ocrImage(imageInput, body.provider)
    return addCorsHeaders(Response.json({ success: true, text }), req)
  } catch (error) {
    return addCorsHeaders(Response.json({ success: false, error: (error as Error).message }, { status: 500 }), req)
  }
}
