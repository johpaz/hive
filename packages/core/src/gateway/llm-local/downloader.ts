/**
 * Hive Local LLM — Downloader
 * Descarga binarios desde GitHub releases y modelos desde HuggingFace
 */

import { existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { detectGPU, getHiveCLIBinaryName, getHiveCLIDownloadURL, getLlamaServerSuffix, getLlamaServerDownloadURL, LLAMA_CPP_DEFAULT_VER } from "./detector"

const LLM_ROOT =
  process.env.HIVE_LLM_ROOT ??
  join(process.env.HIVE_HOME ?? join(homedir(), ".hive"), "llm-local")

export const BIN_DIR = join(LLM_ROOT, "bin")
export const MODELS_DIR = join(LLM_ROOT, "models")

if (!existsSync(BIN_DIR)) mkdirSync(BIN_DIR, { recursive: true })
if (!existsSync(MODELS_DIR)) mkdirSync(MODELS_DIR, { recursive: true })

/** URLs de modelos en HuggingFace (Gemma 4 y Qwen 3.5 según Unsloth) */
export const HF_MODEL_URLS = {
  // mmproj legacy (E4B)
  mmproj: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/mmproj-BF16.gguf",
  // mmproj Gemma 4
  mmproj_gemma4_12b: "https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/main/mmproj-BF16.gguf",
  mmproj_gemma4_26b: "https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/resolve/main/mmproj-BF16.gguf",
  mmproj_gemma4_31b: "https://huggingface.co/unsloth/gemma-4-31B-it-GGUF/resolve/main/mmproj-BF16.gguf",
  // mmproj Qwen 3.5
  mmproj_qwen3_5_2b: "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/mmproj-F16.gguf",
  mmproj_qwen3_5_4b: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/mmproj-F16.gguf",
  mmproj_qwen3_5_9b: "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/mmproj-F16.gguf",
  mmproj_qwen3_5_27b: "https://huggingface.co/unsloth/Qwen3.5-27B-GGUF/resolve/main/mmproj-F16.gguf",
  mmproj_qwen3_5_35b: "https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/mmproj-F16.gguf",
  // modelos Gemma 4
  e2b_Q4_K_XL: "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-UD-Q4_K_XL.gguf",
  e4b_Q4_K_XL: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-UD-Q4_K_XL.gguf",
  gemma4_12b_Q4_K_XL: "https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/main/gemma-4-12b-it-UD-Q4_K_XL.gguf",
  gemma4_26b_Q4_K_M: "https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF/resolve/main/gemma-4-26B-A4B-it-UD-Q4_K_M.gguf",
  gemma4_31b_Q4_K_XL: "https://huggingface.co/unsloth/gemma-4-31B-it-GGUF/resolve/main/gemma-4-31B-it-UD-Q4_K_XL.gguf",
  // modelos Qwen 3.5
  qwen3_5_2b_Q4_K_XL: "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-UD-Q4_K_XL.gguf",
  qwen3_5_4b_Q4_K_XL: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-UD-Q4_K_XL.gguf",
  qwen3_5_9b_Q4_K_XL: "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-UD-Q4_K_XL.gguf",
  qwen3_5_27b_Q4_K_XL: "https://huggingface.co/unsloth/Qwen3.5-27B-GGUF/resolve/main/Qwen3.5-27B-UD-Q4_K_XL.gguf",
  qwen3_5_35b_Q4_K_XL: "https://huggingface.co/unsloth/Qwen3.5-35B-A3B-GGUF/resolve/main/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf",
}

export type ModelId =
  | "mmproj"
  | "mmproj_gemma4_12b"
  | "mmproj_gemma4_26b"
  | "mmproj_gemma4_31b"
  | "mmproj_qwen3_5_2b"
  | "mmproj_qwen3_5_4b"
  | "mmproj_qwen3_5_9b"
  | "mmproj_qwen3_5_27b"
  | "mmproj_qwen3_5_35b"
  | "e2b_Q4_K_XL"
  | "e4b_Q4_K_XL"
  | "gemma4_12b_Q4_K_XL"
  | "gemma4_26b_Q4_K_M"
  | "gemma4_31b_Q4_K_XL"
  | "qwen3_5_2b_Q4_K_XL"
  | "qwen3_5_4b_Q4_K_XL"
  | "qwen3_5_9b_Q4_K_XL"
  | "qwen3_5_27b_Q4_K_XL"
  | "qwen3_5_35b_Q4_K_XL"

/** Modelos que requieren proyector de visión (mmproj) */
export const VISION_MODELS: ModelId[] = [
  "e4b_Q4_K_XL",
  "gemma4_12b_Q4_K_XL",
  "gemma4_26b_Q4_K_M",
  "gemma4_31b_Q4_K_XL",
  "qwen3_5_2b_Q4_K_XL",
  "qwen3_5_4b_Q4_K_XL",
  "qwen3_5_9b_Q4_K_XL",
  "qwen3_5_27b_Q4_K_XL",
  "qwen3_5_35b_Q4_K_XL",
]

/** Mapeo de cada modelo a su mmproj correspondiente */
export const MODEL_MMPROJ_MAP: Record<ModelId, ModelId | undefined> = {
  mmproj: undefined,
  mmproj_gemma4_12b: undefined,
  mmproj_gemma4_26b: undefined,
  mmproj_gemma4_31b: undefined,
  mmproj_qwen3_5_2b: undefined,
  mmproj_qwen3_5_4b: undefined,
  mmproj_qwen3_5_9b: undefined,
  mmproj_qwen3_5_27b: undefined,
  mmproj_qwen3_5_35b: undefined,
  e2b_Q4_K_XL: undefined,
  e4b_Q4_K_XL: "mmproj",
  gemma4_12b_Q4_K_XL: "mmproj_gemma4_12b",
  gemma4_26b_Q4_K_M: "mmproj_gemma4_26b",
  gemma4_31b_Q4_K_XL: "mmproj_gemma4_31b",
  qwen3_5_2b_Q4_K_XL: "mmproj_qwen3_5_2b",
  qwen3_5_4b_Q4_K_XL: "mmproj_qwen3_5_4b",
  qwen3_5_9b_Q4_K_XL: "mmproj_qwen3_5_9b",
  qwen3_5_27b_Q4_K_XL: "mmproj_qwen3_5_27b",
  qwen3_5_35b_Q4_K_XL: "mmproj_qwen3_5_35b",
}

/** Devuelve el ID del mmproj asociado a un modelo, o undefined si no requiere visión */
export function getModelMMProjId(modelId: ModelId): ModelId | undefined {
  return MODEL_MMPROJ_MAP[modelId]
}

export const MODEL_FILES: Record<ModelId, string> = {
  mmproj: "mmproj-BF16.gguf",
  mmproj_gemma4_12b: "mmproj-gemma4-12b-BF16.gguf",
  mmproj_gemma4_26b: "mmproj-gemma4-26b-BF16.gguf",
  mmproj_gemma4_31b: "mmproj-gemma4-31b-BF16.gguf",
  mmproj_qwen3_5_2b: "mmproj-qwen3.5-2b-F16.gguf",
  mmproj_qwen3_5_4b: "mmproj-qwen3.5-4b-F16.gguf",
  mmproj_qwen3_5_9b: "mmproj-qwen3.5-9b-F16.gguf",
  mmproj_qwen3_5_27b: "mmproj-qwen3.5-27b-F16.gguf",
  mmproj_qwen3_5_35b: "mmproj-qwen3.5-35b-F16.gguf",
  e2b_Q4_K_XL: "gemma-4-E2B-it-UD-Q4_K_XL.gguf",
  e4b_Q4_K_XL: "gemma-4-E4B-it-UD-Q4_K_XL.gguf",
  gemma4_12b_Q4_K_XL: "gemma-4-12b-it-UD-Q4_K_XL.gguf",
  gemma4_26b_Q4_K_M: "gemma-4-26B-A4B-it-UD-Q4_K_M.gguf",
  gemma4_31b_Q4_K_XL: "gemma-4-31B-it-UD-Q4_K_XL.gguf",
  qwen3_5_2b_Q4_K_XL: "Qwen3.5-2B-UD-Q4_K_XL.gguf",
  qwen3_5_4b_Q4_K_XL: "Qwen3.5-4B-UD-Q4_K_XL.gguf",
  qwen3_5_9b_Q4_K_XL: "Qwen3.5-9B-UD-Q4_K_XL.gguf",
  qwen3_5_27b_Q4_K_XL: "Qwen3.5-27B-UD-Q4_K_XL.gguf",
  qwen3_5_35b_Q4_K_XL: "Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf",
}

export function getModelPath(modelId: ModelId): string {
  return join(MODELS_DIR, MODEL_FILES[modelId])
}

export function isModelDownloaded(modelId: ModelId): boolean {
  return existsSync(getModelPath(modelId))
}

/** Descarga un archivo con progreso (streaming a disco para evitar OOM) */
export async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`)

  const total = Number(res.headers.get("content-length") ?? 0)
  const reader = res.body?.getReader()
  if (!reader) throw new Error("No body en respuesta")

  const writer = Bun.file(dest).writer()
  let downloaded = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      await writer.write(value)
      downloaded += value.byteLength
      if (onProgress) onProgress(downloaded, total)
    }
    await writer.flush()
    await writer.end()
  } catch (err) {
    try { await writer.end() } catch { /* ignore */ }
    throw err
  }
}

/** Descarga el binario hive-cli si no existe */
export async function installHiveCLI(): Promise<string> {
  const gpu = await detectGPU()
  const binaryName = getHiveCLIBinaryName(gpu)
  const binaryPath = join(BIN_DIR, binaryName)

  if (existsSync(binaryPath)) {
    return binaryPath
  }

  console.log(`[hive-local] Instalando hive-cli para ${gpu.platform} + ${gpu.backend}...`)
  const url = getHiveCLIDownloadURL(binaryName)

  await downloadFile(url, binaryPath, (d, t) => {
    const pct = t > 0 ? ((d / t) * 100).toFixed(1) : "?"
    process.stdout.write(`\r  Descargando... ${pct}%`)
  })
  console.log("")

  if (process.platform !== "win32") {
    await Bun.spawn(["chmod", "+x", binaryPath]).exited
  }

  console.log(`[hive-local] ✓ hive-cli instalado en ${binaryPath}`)
  return binaryPath
}

/** 
 * Busca el binario llama-server sin descargarlo.
 * Retorna la ruta si existe, o null si no está instalado.
 */
export async function findLlamaServerBinary(): Promise<string | null> {
  const ext = process.platform === "win32" ? ".exe" : ""
  const versionDir = join(BIN_DIR, `llama-${LLAMA_CPP_DEFAULT_VER}`)
  const binaryPath = join(versionDir, `llama-server${ext}`)
  return existsSync(binaryPath) ? binaryPath : null
}

/** 
 * Instala llama-server oficial si no existe 
 * Retorna la ruta al binario llama-server.
 * ⚠️ Esta función DESCARGA el binario — solo llamar por acción explícita del usuario.
 */
export async function installLlamaServer(): Promise<string> {
  const gpu = await detectGPU()
  const suffix = getLlamaServerSuffix(gpu)
  const version = LLAMA_CPP_DEFAULT_VER

  // Directorio específico de la versión para evitar conflictos
  const versionDir = join(BIN_DIR, `llama-${version}`)
  const ext = process.platform === "win32" ? ".exe" : ""
  const binaryPath = join(versionDir, `llama-server${ext}`)

  if (existsSync(binaryPath)) {
    return binaryPath
  }

  if (!existsSync(versionDir)) mkdirSync(versionDir, { recursive: true })

  console.log(`[hive-local] Instalando llama-server ${version} para ${gpu.platform} + ${gpu.backend}...`)
  const url = getLlamaServerDownloadURL(suffix, version)
  const isZip = url.endsWith(".zip")
  const archivePath = join(BIN_DIR, `llama-${version}-${suffix}.${isZip ? "zip" : "tar.gz"}`)

  await downloadFile(url, archivePath, (d, t) => {
    const pct = t > 0 ? ((d / t) * 100).toFixed(1) : "?"
    process.stdout.write(`\r  Descargando binarios... ${pct}%`)
  })
  console.log("")

  // Extraer
  console.log(`[hive-local] Extrayendo binarios...`)
  if (isZip) {
    if (process.platform === "win32") {
      await Bun.spawn(["powershell", "-Command", `Expand-Archive -Path "${archivePath}" -DestinationPath "${versionDir}" -Force`]).exited
    } else {
      await Bun.spawn(["unzip", "-o", archivePath, "-d", versionDir]).exited
    }
  } else {
    // El tar.gz oficial contiene una carpeta llama-bXXXXX/
    await Bun.spawn(["tar", "-xzf", archivePath, "-C", BIN_DIR]).exited
  }

  // Limpiar archivo descargado
  try {
    const { unlinkSync } = await import("fs")
    unlinkSync(archivePath)
  } catch { /* ignore */ }

  if (process.platform !== "win32") {
    // Dar permisos a todos los binarios extraídos
    await Bun.spawn(["chmod", "-R", "+x", versionDir]).exited
  }

  console.log(`[hive-local] ✓ llama-server instalado en ${binaryPath}`)
  return binaryPath
}

/** Descarga un modelo si no existe */
export async function downloadModel(
  modelId: ModelId,
  onProgress?: (downloaded: number, total: number) => void
): Promise<string> {
  const dest = getModelPath(modelId)

  if (existsSync(dest)) {
    return dest
  }

  const url = HF_MODEL_URLS[modelId]
  console.log(`[hive-local] Descargando modelo ${modelId}...`)

  await downloadFile(url, dest, onProgress)
  console.log(`[hive-local] ✓ Modelo ${modelId} descargado`)

  // Advertir si el modelo requiere visión y no tenemos su mmproj (NO descargar automáticamente)
  const mmprojId = getModelMMProjId(modelId)
  if (mmprojId && !isModelDownloaded(mmprojId)) {
    console.warn(`[hive-local] ⚠️ El modelo ${modelId} requiere el proyector de visión (${mmprojId}). Descárgalo manualmente desde la UI.`)
  }

  return dest
}

/** Descarga mmproj en postinstall (ligero) */
export async function installMMProj(): Promise<string> {
  return downloadModel("mmproj")
}

/** Lista modelos disponibles localmente (solo modelos de texto/visión finales) */
export function listLocalModels(): { id: ModelId; name: string; size: string; downloaded: boolean }[] {
  const models: ModelId[] = [
    "e2b_Q4_K_XL",
    "e4b_Q4_K_XL",
    "gemma4_12b_Q4_K_XL",
    "gemma4_26b_Q4_K_M",
    "gemma4_31b_Q4_K_XL",
    "qwen3_5_2b_Q4_K_XL",
    "qwen3_5_4b_Q4_K_XL",
    "qwen3_5_9b_Q4_K_XL",
    "qwen3_5_27b_Q4_K_XL",
    "qwen3_5_35b_Q4_K_XL",
  ]
  const sizeMap: Record<string, string> = {
    e2b_Q4_K_XL: "~3 GB",
    e4b_Q4_K_XL: "~5 GB",
    gemma4_12b_Q4_K_XL: "~7 GB",
    gemma4_26b_Q4_K_M: "~10 GB",
    gemma4_31b_Q4_K_XL: "~14 GB",
    qwen3_5_2b_Q4_K_XL: "~1.2 GB",
    qwen3_5_4b_Q4_K_XL: "~2.5 GB",
    qwen3_5_9b_Q4_K_XL: "~5.4 GB",
    qwen3_5_27b_Q4_K_XL: "~16 GB",
    qwen3_5_35b_Q4_K_XL: "~21 GB",
  }
  return models.map((id) => ({
    id,
    name: MODEL_FILES[id],
    size: sizeMap[id] || "~?",
    downloaded: isModelDownloaded(id),
  }))
}
