import { afterEach, beforeEach, expect, test } from "bun:test"
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap"
import type { ModelDoc, ProviderDoc } from "../packages/core/src/storage/collections"
import { col, updateDoc } from "../packages/core/src/storage/hive"
import { closeHiveDb } from "../packages/core/src/storage/hivedb"
import { handleGetModels } from "../packages/core/src/gateway/routes/models"
import { handleGetConfiguredVoiceProviders } from "../packages/core/src/gateway/routes/voice"
import { deleteProviderApiKey, storeProviderApiKey } from "../packages/core/src/storage/crypto"
import { voiceService } from "../packages/core/src/voice"

const realFetch = globalThis.fetch
// El llavero del sistema no depende de HIVE_HOME: sin este doble, estos tests leen las API keys
// reales del usuario (y un fallo de aserción las imprime). crypto.ts admite reemplazar Bun.secrets.
const realSecrets = (Bun as any).secrets
const audio = { type: "base64", data: "YXVkaW8=", mimeType: "audio/webm" } as const

beforeEach(async () => {
  ;(Bun as any).secrets = { get: async () => null, set: async () => {}, delete: async () => false }
  closeHiveDb()
  await ensureHiveDb()
  // La caché de secretos es del proceso: otros archivos pudieron llenarla con claves reales.
  for (const provider of ["gemini", "openai", "elevenlabs", "groq", "openrouter", "nvidia"]) await deleteProviderApiKey(provider)
})

afterEach(() => {
  ;(Bun as any).secrets = realSecrets
  globalThis.fetch = realFetch
  closeHiveDb()
})

function withKey(name: string, fn: () => Promise<void>) {
  const previous = process.env[name]
  process.env[name] = "test-key"
  return fn().finally(() => {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  })
}

test("el catálogo de voz exige una credencial guardada en Providers", async () => {
  const configured = async () => (await handleGetConfiguredVoiceProviders(
    new Request("http://localhost/api/voice/configured-providers"), value => value,
  )).json()
  await withKey("GEMINI_API_KEY", async () => {
    try {
      expect((await configured()).gemini).toBe(false)
      await storeProviderApiKey("gemini", "   ")
      expect((await configured()).gemini).toBe(false)
      await storeProviderApiKey("gemini", "stored-test-key")
      expect((await configured()).gemini).toBe(true)
    } finally {
      await deleteProviderApiKey("gemini")
    }
  })
})

test("Gemini transcribe con audio inline y mantiene el tipo de modelo de chat", async () => {
  const response = await handleGetModels(new Request("http://localhost/api/models?provider_id=gemini"), value => value)
  const { models } = await response.json()
  expect(models.find((model: ModelDoc) => model.id === "gemini-3.8-flash")).toMatchObject({ model_type: "llm", supports_stt: true })
  expect(models.find((model: ModelDoc) => model.id === "gemini-3.8-flash-tts")).toMatchObject({ supports_stt: false })

  await withKey("GEMINI_API_KEY", async () => {
    globalThis.fetch = (async (url, options) => {
      expect(String(url)).toEndWith("/models/gemini-3.8-flash:generateContent")
      expect(new Headers(options?.headers).get("x-goog-api-key")).toBe("test-key")
      expect(JSON.parse(String(options?.body)).contents[0].parts[1]).toEqual({
        inlineData: { mimeType: "audio/webm", data: audio.data },
      })
      return Response.json({ candidates: [{ content: { parts: [{ text: "thought", thought: true }, { text: "Hola, Hive." }] } }] })
    }) as typeof fetch
    expect(await voiceService.transcribe(audio, "gemini-3.8-flash")).toBe("Hola, Hive.")
  })
})

test("OpenAI y ElevenLabs reciben el identificador seleccionado", async () => {
  for (const [env, path, parameter, model] of [
    ["OPENAI_API_KEY", "/audio/transcriptions", "model", "gpt-transcribe"],
    ["ELEVENLABS_API_KEY", "/speech-to-text", "model_id", "scribe_v3"],
  ]) {
    await withKey(env, async () => {
      globalThis.fetch = (async (url, options) => {
        expect(String(url)).toEndWith(path)
        expect((options?.body as FormData).get(parameter)).toBe(model)
        return Response.json({ text: "Hola." })
      }) as typeof fetch
      expect(await voiceService.transcribe(audio, model)).toBe("Hola.")
    })
  }
})

test("OpenRouter despacha el modelo NVIDIA sin el prefijo interno de Hive", async () => {
  const models = await col<ModelDoc>("models")
  const id = "openrouter/nvidia/nemotron-3.5-transcribe"
  await models.put(id, {
    id, provider_id: "openrouter", name: "Nemotron Transcribe", model_type: "stt",
    enabled: true, active: true, capabilities: null, context_window: 0,
  })
  await withKey("OPENROUTER_API_KEY", async () => {
    globalThis.fetch = (async (url, options) => {
      expect(String(url)).toBe("https://openrouter.ai/api/v1/audio/transcriptions")
      expect((options?.body as FormData).get("model")).toBe("nvidia/nemotron-3.5-transcribe")
      return Response.json({ text: "Hola." })
    }) as typeof fetch
    expect(await voiceService.transcribe(audio, id)).toBe("Hola.")
  })
})

test("NVIDIA directo usa un endpoint Speech NIM configurado", async () => {
  const models = await col<ModelDoc>("models")
  const id = "nvidia/canary-1b"
  await models.put(id, {
    id, provider_id: "nvidia", name: "Canary 1B", model_type: "stt",
    enabled: true, active: true, capabilities: null, context_window: 0,
  })
  const wav = { ...audio, mimeType: "audio/wav" }
  await expect(voiceService.transcribe(wav, id)).rejects.toThrow("no está disponible para transcripción")
  await updateDoc<ProviderDoc>("providers", "nvidia", { base_url: "http://localhost:9000" })
  globalThis.fetch = (async (url, options) => {
    expect(String(url)).toBe("http://localhost:9000/v1/audio/transcriptions")
    expect((options?.body as FormData).get("model")).toBe("canary-1b")
    return Response.json({ text: "Hola." })
  }) as typeof fetch
  expect(await voiceService.transcribe(wav, id)).toBe("Hola.")
})
