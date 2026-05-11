import { getDb } from "../../storage/sqlite"
import { voiceService } from "../../voice"
import { storeProviderApiKey, loadProviderApiKey } from "../../storage/crypto"

export async function handleGetVoiceProviders(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  return addCorsHeaders(Response.json({
    providers: ["elevenlabs", "openai", "gemini", "qwen", "groq", "piper", "local-llama"]
  }), req)
}

export async function handleGetConfiguredVoiceProviders(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const voiceProviderIds = ["groq", "elevenlabs", "openai", "gemini", "qwen"]
  const results = await Promise.all(voiceProviderIds.map(async id => ({
    id,
    configured: !!(await loadProviderApiKey(id))
  })))

  const providers: Record<string, boolean> = {}
  for (const r of results) providers[r.id] = r.configured
  providers.piper = true
  providers["local-llama"] = true

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

    // Get base URL for the provider
    let baseUrl = ""
    switch (providerId) {
      case "groq":       baseUrl = "https://api.groq.com/openai/v1"; break
      case "elevenlabs": baseUrl = "https://api.elevenlabs.io/v1"; break
      case "openai":     baseUrl = "https://api.openai.com/v1"; break
      case "gemini":     baseUrl = "https://generativelanguage.googleapis.com/v1beta"; break
      case "qwen":       baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1"; break
      default:
        return addCorsHeaders(Response.json({ success: false, error: "Unknown provider" }, { status: 400 }), req)
    }

    db.query(`
      INSERT OR REPLACE INTO providers (id, name, base_url, enabled, active)
      VALUES (?, ?, ?, 1, 1)
    `).run(providerId, providerId, baseUrl)

    await storeProviderApiKey(providerId, apiKey)

    return addCorsHeaders(Response.json({ success: true, provider: providerId }), req)
  } catch (error) {
    return addCorsHeaders(Response.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    ), req)
  }
}

export async function handleGetVoiceProviderVoices(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  providerId: string
): Promise<Response> {
  try {
    let voices: Array<{ id: string; name: string }>

    switch (providerId) {
      case "elevenlabs":
        voices = await voiceService.getElevenLabsVoices()
        break
      case "openai":
        voices = voiceService.getOpenAIVoices()
        break
      case "gemini":
        voices = voiceService.getGeminiVoices()
        break
      case "qwen":
        voices = voiceService.getQwenVoices()
        break
      case "piper": {
        // Consultar voces disponibles en el servidor TTS local
        const TTS_PORT = Number(process.env.TTS_PORT ?? 5500)
        try {
          const res = await fetch(`http://localhost:${TTS_PORT}/voices`, {
            signal: AbortSignal.timeout(1000),
          })
          if (res.ok) {
            const data = await res.json()
            voices = (data.voices || []).map((v: string) => ({
              id: v,
              name: v.replace(/_/g, " ").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
            }))
          } else {
            voices = [{ id: "es_MX-claude-14947-epoch-high", name: "Piper Local (Claude Spanish)" }]
          }
        } catch {
          // Servidor TTS no disponible - usar fallback para permitir selección
          voices = [{ id: "es_MX-claude-14947-epoch-high", name: "Piper Local (Claude Spanish)" }]
        }
        break
      }
      default:
        return addCorsHeaders(Response.json({ voices: [] }), req)
    }

    return addCorsHeaders(Response.json({ voices }), req)
  } catch (error) {
    return addCorsHeaders(Response.json(
      { voices: [], error: (error as Error).message },
      { status: 200 }
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
