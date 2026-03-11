import { getDb } from "../../storage/sqlite"
import { voiceService } from "../../voice"

export async function handleGetVoiceProviders(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  return addCorsHeaders(Response.json({
    providers: ["elevenlabs", "openai", "gemini", "qwen"]
  }), req)
}

export async function handleGetConfiguredVoiceProviders(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  return addCorsHeaders(Response.json({
    providers: []
  }), req)
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
    db.query(`UPDATE user_channels SET ${updates.join(", ")} WHERE channel = ?`).run(...params as any[])
  }

  return addCorsHeaders(Response.json({ success: true }), req)
}
