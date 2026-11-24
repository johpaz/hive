import type { ModelDoc } from "../storage/collections"

export const GEMINI_AUDIO_INPUT = "audio_input"
export const NVIDIA_CHAT_HOST = "integrate.api.nvidia.com"

// Gemini's ListModels reports generation methods, but commonly omits input
// modalities. Flash and Pro text-output families support recorded audio.
export function isGeminiAudioFamily(id: string): boolean {
  return /^gemini-(?:2\.5|3(?:\.\d+)?|4(?:\.\d+)?)-(?:flash(?:-lite)?|pro)(?:-preview(?:-\d{2}-\d{4})?)?$/.test(id) ||
    /^gemini-(?:flash(?:-lite)?|pro)-latest$/.test(id)
}

export function nvidiaSttBase(baseUrl?: string | null): string | undefined {
  if (!baseUrl || !URL.canParse(baseUrl)) return
  const url = new URL(baseUrl)
  if (!["http:", "https:"].includes(url.protocol) || url.hostname === NVIDIA_CHAT_HOST) return
  const base = baseUrl.replace(/\/+$/, "")
  return base.endsWith("/v1") ? base : `${base}/v1`
}

export function supportsStt(model: ModelDoc, baseUrl?: string | null): boolean {
  if (model.unlisted) return false
  if (model.provider_id === "gemini") {
    return model.model_type === "llm" &&
      (!!model.capabilities?.includes(`"${GEMINI_AUDIO_INPUT}"`) || isGeminiAudioFamily(model.id))
  }
  if (model.model_type !== "stt") return false
  switch (model.provider_id) {
    case "groq":
    case "openai":
    case "openrouter":
    case "elevenlabs":
      return true
    case "nvidia":
      return !!nvidiaSttBase(baseUrl)
    default:
      return false
  }
}
