import { multimodalService } from "../../multimodal/index"
import { getDb } from "../../storage/sqlite"

export async function handleGetVisionProviders(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const configured = multimodalService.getConfiguredVisionProviders()
  const db = getDb()
  const visionModels = db.query(`
    SELECT m.id, m.name, m.provider_id, m.capabilities
    FROM models m
    JOIN providers p ON m.provider_id = p.id
    WHERE m.enabled = 1 AND p.enabled = 1 AND p.api_key_encrypted IS NOT NULL AND p.api_key_encrypted != ''
  `).all() as Array<{ id: string; name: string; provider_id: string; capabilities: string }>

  const modelsWithVision = visionModels.filter(m => {
    try {
      const caps = JSON.parse(m.capabilities || "[]") as string[]
      return caps.includes("vision")
    } catch { return false }
  })

  return addCorsHeaders(Response.json({
    configuredProviders: configured,
    visionModels: modelsWithVision.map(m => ({
      id: m.id,
      name: m.name,
      providerId: m.provider_id,
    })),
  }), req)
}

export async function handleGetChannelVision(req: Request, addCorsHeaders: (r: Response, req: Request) => Response, channelId: string): Promise<Response> {
  const config = multimodalService.getChannelVisionConfig(channelId)
  return addCorsHeaders(Response.json(config), req)
}

export async function handleUpdateChannelVision(req: Request, addCorsHeaders: (r: Response, req: Request) => Response, channelId: string): Promise<Response> {
  const body = await req.json().catch(() => ({})) as {
    visionEnabled?: boolean
    ocrProvider?: string
    visionProvider?: string
    visionModelId?: string
  }

  const db = getDb()
  const updates: string[] = []
  const values: any[] = []

  if (body.visionEnabled !== undefined) {
    updates.push("vision_enabled = ?")
    values.push(body.visionEnabled ? 1 : 0)
  }
  if (body.ocrProvider !== undefined) {
    updates.push("ocr_provider = ?")
    values.push(body.ocrProvider)
  }
  if (body.visionProvider !== undefined) {
    updates.push("vision_provider = ?")
    values.push(body.visionProvider)
  }
  if (body.visionModelId !== undefined) {
    updates.push("vision_model_id = ?")
    values.push(body.visionModelId)
  }

  if (updates.length === 0) {
    return addCorsHeaders(Response.json({ success: false, error: "No fields to update" }, { status: 400 }), req)
  }

  values.push(channelId)
  db.query(`UPDATE channels SET ${updates.join(", ")} WHERE id = ?`).run(...values)

  const updated = multimodalService.getChannelVisionConfig(channelId)
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
