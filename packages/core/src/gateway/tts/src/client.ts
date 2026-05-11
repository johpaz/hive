/**
 * Hive TTS Client
 * Importar desde packages/hivelearn u otros paquetes de Hive.
 * No bloqueante: si TTS no está disponible, las funciones retornan null silenciosamente.
 */

const TTS_URL = process.env.TTS_URL ?? "http://localhost:5500"

export async function isTTSAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${TTS_URL}/health`, {
      signal: AbortSignal.timeout(500),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function synthesize(
  text: string,
  voice?: string
): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`${TTS_URL}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    return res.arrayBuffer()
  } catch {
    return null
  }
}

export async function synthesizeToFile(
  text: string,
  outputPath: string,
  voice?: string
): Promise<boolean> {
  const audio = await synthesize(text, voice)
  if (!audio) return false
  await Bun.write(outputPath, audio)
  return true
}

export async function listVoices(): Promise<string[]> {
  try {
    const res = await fetch(`${TTS_URL}/voices`, {
      signal: AbortSignal.timeout(500),
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.voices ?? []
  } catch {
    return []
  }
}
