import { getDb } from "../../storage/sqlite"
import { voiceService } from "../../voice"
import { encryptApiKey } from "../../storage/crypto"

export async function handleGetVoiceProviders(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  return addCorsHeaders(Response.json({
    providers: ["elevenlabs", "openai", "gemini", "qwen", "groq"]
  }), req)
}

export async function handleGetConfiguredVoiceProviders(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const db = getDb()
  // Check which voice providers have API keys configured
  const rows = db.query(`
    SELECT id, 
      CASE WHEN api_key_encrypted IS NOT NULL AND api_key_encrypted != '' THEN 1 ELSE 0 END as configured
    FROM providers
    WHERE id IN ('groq', 'elevenlabs', 'openai', 'gemini', 'qwen')
  `).all() as Array<{ id: string; configured: number }>

  const providers: Record<string, boolean> = {}
  for (const row of rows) {
    providers[row.id] = row.configured === 1
  }

  return addCorsHeaders(Response.json(providers), req)
}

export async function handleSaveVoiceProviderKey(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  const url = new URL(req.url)
  const providerIdMatch = url.pathname.match(/^\/api\/voice\/providers\/([^/]+)\/key$/)

  if (!providerIdMatch) {
    return addCorsHeaders(Response.json({ success: false, error: "Invalid path" }, { status: 400 }), req)
  }

  const providerId = providerIdMatch[1]
  const body = await req.json().catch(() => ({}))
  const { apiKey } = body

  if (!apiKey) {
    return addCorsHeaders(Response.json({ success: false, error: "apiKey required" }, { status: 400 }), req)
  }

  try {
    const db = getDb()
    const encrypted = await encryptApiKey(apiKey)

    // Get base URL for the provider
    let baseUrl = ""
    switch (providerId) {
      case "groq":
        baseUrl = "https://api.groq.com/openai/v1"
        break
      case "elevenlabs":
        baseUrl = "https://api.elevenlabs.io/v1"
        break
      case "openai":
        baseUrl = "https://api.openai.com/v1"
        break
      case "gemini":
        baseUrl = "https://generativelanguage.googleapis.com/v1beta"
        break
      case "qwen":
        baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1"
        break
      default:
        return addCorsHeaders(Response.json({ success: false, error: "Unknown provider" }, { status: 400 }), req)
    }

    // Insert or update provider with API key
    db.query(`
      INSERT OR REPLACE INTO providers (id, name, base_url, api_key_encrypted, api_key_iv, enabled, active)
      VALUES (?, ?, ?, ?, ?, 1, 1)
    `).run(providerId, providerId, baseUrl, encrypted.encrypted, encrypted.iv)

    return addCorsHeaders(Response.json({ success: true, provider: providerId }))
  } catch (error) {
    return addCorsHeaders(Response.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    ), req)
  }
}

export async function handleTestVoice(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const { text, provider, voiceId } = body

  if (!text || !provider) {
    return addCorsHeaders(Response.json({ success: false, error: "text and provider required" }), req)
  }

  return addCorsHeaders(Response.json({ success: true, message: "Voice test placeholder" }), req)
}

export async function handleGetChannelVoice(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelId: string
): Promise<Response> {
  const voiceConfig = voiceService.getChannelVoiceConfig(channelId)
  return addCorsHeaders(Response.json(voiceConfig), req)
}

export async function handleUpdateChannelVoice(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelId: string
): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const db = getDb()
  const updates: string[] = []
  const params: unknown[] = []

  if (body.voiceEnabled !== undefined) { 
    updates.push("voice_enabled = ?")
    params.push(body.voiceEnabled ? 1 : 0) 
  }
  if (body.ttsEnabled !== undefined) { 
    updates.push("tts_enabled = ?")
    params.push(body.ttsEnabled ? 1 : 0) 
  }
  if (body.sttProvider !== undefined) { 
    updates.push("stt_provider = ?")
    params.push(body.sttProvider) 
  }
  if (body.ttsProvider !== undefined) { 
    updates.push("tts_provider = ?")
    params.push(body.ttsProvider) 
  }
  if (body.ttsVoiceId !== undefined) { 
    updates.push("tts_voice_id = ?")
    params.push(body.ttsVoiceId) 
  }

  if (updates.length > 0) {
    params.push(channelId)
    db.query(`UPDATE channels SET ${updates.join(", ")} WHERE id = ?`).run(...params as any[])
  }

  return addCorsHeaders(Response.json({ success: true }), req)
}
