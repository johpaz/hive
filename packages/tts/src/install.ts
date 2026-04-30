#!/usr/bin/env bun
/**
 * Hive TTS — postinstall
 * Descarga el binario de Piper + shared libs y el modelo de voz español.
 * Solo descarga si no están ya presentes en packages/tts/bin/ y voices/
 */

import { existsSync, mkdirSync, readdirSync, renameSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import {
  detectPlatform,
  PIPER_URLS,
  VOICE_URLS,
  getPiperBinaryName,
  DEFAULT_VOICE,
} from "./detect.ts"

const log = {
  info: (msg: string) => console.log(`[TTS] ${msg}`),
  warn: (msg: string) => console.warn(`[TTS] ${msg}`),
  error: (msg: string) => console.error(`[TTS] ${msg}`),
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const BIN_DIR = join(ROOT, "bin")
const VOICES_DIR = join(ROOT, "voices")

mkdirSync(BIN_DIR, { recursive: true })
mkdirSync(VOICES_DIR, { recursive: true })

async function downloadFile(url: string, dest: string): Promise<void> {
  const filename = url.split("/").pop()!
  log.info(`Descargando ${filename}...`)

  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`)

  // Usar arrayBuffer() — Bun.write(dest, Response) no consume el body correctamente
  const totalBytes = Number(res.headers.get("content-length") ?? 0)
  const buf = await res.arrayBuffer()
  await Bun.write(dest, buf)

  const mb = (buf.byteLength / 1024 / 1024).toFixed(1)
  log.info(`${filename} — ${mb} MB`)
}

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  const proc = Bun.spawn(["tar", "-xzf", archivePath, "-C", destDir], {
    stdout: "inherit",
    stderr: "inherit",
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`tar falló con código ${code}`)
  await Bun.spawn(["rm", "-f", archivePath]).exited
}

async function extractZip(archivePath: string, destDir: string): Promise<void> {
  const proc = Bun.spawn(["unzip", "-q", archivePath, "-d", destDir], {
    stdout: "inherit",
    stderr: "inherit",
  })
  const code = await proc.exited
  if (code !== 0) throw new Error(`unzip falló con código ${code}`)
  await Bun.spawn(["rm", "-f", archivePath]).exited
}

async function installPiper(): Promise<void> {
  const platform = detectPlatform()
  const binaryName = getPiperBinaryName(platform)
  const binaryPath = join(BIN_DIR, binaryName)

  if (existsSync(binaryPath)) {
    log.info("Piper ya instalado, omitiendo descarga.")
    return
  }

  const url = PIPER_URLS[platform]
  const archiveExt = url.endsWith(".zip") ? ".zip" : ".tar.gz"
  const archivePath = join(BIN_DIR, `piper${archiveExt}`)

  log.info(`Instalando Piper para ${platform}...`)
  await downloadFile(url, archivePath)

  log.info("Extrayendo...")
  if (archiveExt === ".zip") {
    await extractZip(archivePath, BIN_DIR)
  } else {
    await extractTarGz(archivePath, BIN_DIR)
  }

  // El tar extrae en piper/ con el binario Y sus shared libraries.
  // Mover TODO el contenido de piper/ a BIN_DIR — el binario necesita las .so junto a él.
  // Usamos nombre temporal para evitar colisión: bin/piper/piper → bin/piper (directorio existe)
  const piperSubdir = join(BIN_DIR, "piper")
  if (existsSync(piperSubdir)) {
    const tempDir = join(BIN_DIR, "_piper_tmp")
    renameSync(piperSubdir, tempDir)           // bin/piper/ → bin/_piper_tmp/
    for (const entry of readdirSync(tempDir)) {
      renameSync(join(tempDir, entry), join(BIN_DIR, entry))
    }
    await Bun.spawn(["rm", "-rf", tempDir]).exited
  }

  if (!existsSync(binaryPath)) {
    throw new Error(`Binario no encontrado tras extracción: ${binaryPath}`)
  }

  if (!platform.startsWith("windows")) {
    await Bun.spawn(["chmod", "+x", binaryPath]).exited
  }

  log.info(`Piper instalado en ${BIN_DIR}`)
}

async function installVoice(): Promise<void> {
  const modelPath = join(VOICES_DIR, `${DEFAULT_VOICE}.onnx`)
  const configPath = join(VOICES_DIR, `${DEFAULT_VOICE}.onnx.json`)

  if (existsSync(modelPath) && existsSync(configPath)) {
    log.info("Modelo de voz ya instalado, omitiendo descarga.")
    return
  }

  log.info(`Descargando modelo de voz ${DEFAULT_VOICE}...`)

  await downloadFile(VOICE_URLS.model, modelPath)
  await downloadFile(VOICE_URLS.config, configPath)

  log.info(`Voz instalada en ${VOICES_DIR}`)
}

async function main(): Promise<void> {
  try {
    await installPiper()
    await installVoice()
    log.info("Hive TTS listo. Inicialo con: bun run packages/tts/src/server.ts")
  } catch (err) {
    log.error(`Hive TTS no pudo instalarse: ${err instanceof Error ? err.message : err}`)
    log.error("Reintenta con: bun run packages/tts/src/install.ts")
    process.exit(1)
  }
}

main()
