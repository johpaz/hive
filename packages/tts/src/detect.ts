export type Platform =
  | "linux-x64"
  | "linux-arm64"
  | "windows-x64"
  | "macos-x64"
  | "macos-arm64"

export function detectPlatform(): Platform {
  const os = process.platform
  const arch = process.arch

  if (os === "linux" && arch === "x64") return "linux-x64"
  if (os === "linux" && arch === "arm64") return "linux-arm64"
  if (os === "win32" && arch === "x64") return "windows-x64"
  if (os === "darwin" && arch === "x64") return "macos-x64"
  if (os === "darwin" && arch === "arm64") return "macos-arm64"

  throw new Error(`Plataforma no soportada: ${os}/${arch}`)
}

const PIPER_VERSION = "2023.11.14-2"
const PIPER_BASE_URL = `https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}`

export const PIPER_URLS: Record<Platform, string> = {
  "linux-x64": `${PIPER_BASE_URL}/piper_linux_x86_64.tar.gz`,
  "linux-arm64": `${PIPER_BASE_URL}/piper_linux_aarch64.tar.gz`,
  "windows-x64": `${PIPER_BASE_URL}/piper_windows_amd64.zip`,
  "macos-x64": `${PIPER_BASE_URL}/piper_macos_x86_64.tar.gz`,
  "macos-arm64": `${PIPER_BASE_URL}/piper_macos_aarch64.tar.gz`,
}

export function getPiperBinaryName(platform: Platform): string {
  return platform.startsWith("windows") ? "piper.exe" : "piper"
}

export const DEFAULT_VOICE = "es_MX-claude-14947-epoch-high"
export const VOICE_BASE_URL =
  "https://huggingface.co/spaces/HirCoir/Piper-TTS-Spanish"
export const VOICE_URLS = {
  model: `${VOICE_BASE_URL}/resolve/main/es_MX-claude-14947-epoch-high.onnx`,
  config: `${VOICE_BASE_URL}/resolve/main/es_MX-claude-14947-epoch-high.onnx.json`,
}
