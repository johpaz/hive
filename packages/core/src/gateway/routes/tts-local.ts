import { getLocalTTSStatus, getLocalVoices, LocalTTSError, startLocalTTS, stopLocalTTS, synthesizeLocalTTS } from "../tts/kitten"

type Cors = (response: Response, request: Request) => Response

export function handleGetLocalTTSStatus(req: Request, addCors: Cors): Response {
  return addCors(Response.json(getLocalTTSStatus()), req)
}

export function handleStartLocalTTS(req: Request, addCors: Cors): Response {
  return addCors(Response.json({ started: startLocalTTS() }), req)
}

export async function handleStopLocalTTS(req: Request, addCors: Cors): Promise<Response> {
  await stopLocalTTS()
  return addCors(Response.json({ stopped: true }), req)
}

export function handleGetLocalVoices(req: Request, addCors: Cors): Response {
  return addCors(Response.json({ voices: getLocalVoices() }), req)
}

export async function handleSpeakLocalTTS(req: Request, addCors: Cors): Promise<Response> {
  const body = await req.json().catch(() => null)
  const text = typeof body?.text === "string" ? body.text.trim() : ""
  if (!text || (body.voice !== undefined && typeof body.voice !== "string")) {
    return addCors(Response.json({ error: "Se requiere texto y una voz válida" }, { status: 400 }), req)
  }
  try {
    const audio = await synthesizeLocalTTS(text, body.voice)
    return addCors(new Response(audio.body, { headers: { "Content-Type": "audio/wav" } }), req)
  } catch (cause) {
    const message = cause instanceof LocalTTSError ? cause.message : "Kitten TTS no disponible"
    return addCors(Response.json({ error: message }, { status: cause instanceof LocalTTSError ? cause.status : 503 }), req)
  }
}
