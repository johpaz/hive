export const LOCAL_TTS_PROVIDER = "kitten"
export const LOCAL_TTS_MODEL = "kitten-tts-2-mini"
export const DEFAULT_LOCAL_VOICE = "lucia"

export function isLegacyPiper(id: string): boolean {
  return id === "piper" || id === "piper-local" || id.startsWith("piper/") ||
    /^es_(?:MX|ES)-.+-epoch-(?:low|medium|high)$/.test(id)
}
