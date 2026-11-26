import { col, updateDoc } from "../../storage/hive"
import type { ModelDoc, ProviderDoc, ChannelDoc } from "../../storage/collections"
import { voiceService } from "../../voice"
import { LOCAL_TTS_PROVIDER } from "../../voice/local-model"
import { nvidiaSttBase, supportsStt } from "../../voice/stt-models"
import { getLocalTTSStatus, getLocalVoices } from "../tts/kitten"
import { storeProviderApiKey, loadProviderApiKey } from "../../storage/crypto"
import { refreshVideoCapabilities } from "../../storage/video-capabilities"

/** Providers de voz = providers con al menos un modelo STT/TTS en la BD. */
async function getVoiceProviderIds(): Promise<string[]> {
  const modelsCol = await col<ModelDoc>("models")
  const [models, nvidia] = await Promise.all([
    modelsCol.scan({}),
    (await col<ProviderDoc>("providers")).get("nvidia"),
  ])
  const ids = new Set(models
    .filter(({ doc }) => doc.model_type === "tts" || supportsStt(doc, nvidia?.doc.base_url))
    .map(({ doc }) => doc.provider_id))
  return [...ids]
}

async function isVoiceProviderConfigured(id: string): Promise<boolean> {
  if (id === LOCAL_TTS_PROVIDER) return getLocalTTSStatus().running
  if (id === "nvidia") {
    const provider = await (await col<ProviderDoc>("providers")).get(id)
    if (nvidiaSttBase(provider?.doc.base_url)) return true
  }
  // Match the credentials shown in Providers. Process environment keys can
  // still be used by the runtime, but don't configure a provider in the UI.
  return !!(await loadProviderApiKey(id)).trim()
}

export async function handleGetVoiceProviders(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  return addCorsHeaders(Response.json({
    providers: await getVoiceProviderIds()
  }), req)
}

export async function handleGetConfiguredVoiceProviders(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const voiceProviderIds = await getVoiceProviderIds()
  const results = await Promise.all(voiceProviderIds.map(async id => ({
    id,
    configured: await isVoiceProviderConfigured(id)
  })))

  const providers: Record<string, boolean> = {}
  for (const r of results) providers[r.id] = r.configured

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
    // El provider debe existir en la BD (viene del seed o fue creado por el usuario)
    const providersCol = await col<ProviderDoc>("providers")
    const provider = await providersCol.get(providerId)
    if (!provider) {
      return addCorsHeaders(Response.json({ success: false, error: "Unknown provider" }, { status: 400 }), req)
    }

    // No tocar enabled/active: groq/openai/gemini/qwen son filas compartidas entre voz
    // (STT/TTS) y chat LLM, y "configurado" para voz sólo depende de si hay key guardada
    // (ver handleGetConfiguredVoiceProviders) — activar el provider aquí lo expondría
    // como proveedor de chat completo sin que el usuario lo haya elegido para eso.
    await storeProviderApiKey(providerId, apiKey)
    await refreshVideoCapabilities(providerId)

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
    const modelId = new URL(req.url).searchParams.get("model")
    if (modelId) {
      const model = await (await col<ModelDoc>("models")).get(modelId)
      if (model?.doc.provider_id !== providerId || model.doc.model_type !== "tts") {
        return addCorsHeaders(Response.json({ voices: [], error: "Modelo TTS desconocido" }, { status: 404 }), req)
      }
    }
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
      case "groq":
        voices = voiceService.getGroqVoices(modelId ?? undefined)
        break
      case "qwen":
        voices = voiceService.getQwenVoices()
        break
      case LOCAL_TTS_PROVIDER:
        voices = getLocalVoices()
        break
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
  const voiceConfig = await voiceService.getChannelVoiceConfig(channelId)
  return addCorsHeaders(Response.json(voiceConfig), req)
}

export async function handleUpdateChannelVoice(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelId: string
): Promise<Response> {
  const body = await req.json().catch(() => ({}))

  const patch: Partial<ChannelDoc> = {}
  if (body.voiceEnabled !== undefined) patch.voice_enabled = !!body.voiceEnabled
  if (body.ttsEnabled !== undefined) patch.tts_enabled = !!body.ttsEnabled
  if (body.sttProvider !== undefined) patch.stt_provider = body.sttProvider
  if (body.ttsProvider !== undefined) patch.tts_provider = body.ttsProvider
  if (body.ttsVoiceId !== undefined) patch.tts_voice_id = body.ttsVoiceId

  if (Object.keys(patch).length > 0) {
    await updateDoc<ChannelDoc>("channels", channelId, patch).catch(() => { /* not found */ })
  }

  return addCorsHeaders(Response.json({ success: true }), req)
}
