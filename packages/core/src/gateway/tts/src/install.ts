#!/usr/bin/env bun
/**
 * Hive TTS — instalador de Piper
 * Los datos se guardan en $HIVE_HOME/tts/ (por defecto ~/.hive/tts/).
 */

import { existsSync, mkdirSync, readdirSync, renameSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import {
  detectPlatform,
  PIPER_URLS,
  VOICE_URLS,
  getPiperBinaryName,
  DEFAULT_VOICE,
} from "./detect.js"

const log = {
  info: (msg: string) => console.log(`[TTS] ${msg}`),
  warn: (msg: string) => console.warn(`[TTS] ${msg}`),
  error: (msg: string) => console.error(`[TTS] ${msg}`),
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const filename = url.split("/").pop()!
  log.info(`Descargando ${filename}...`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`)
  const buf = await res.arrayBuffer()
  await Bun.write(dest, buf)
  log.info(`${filename} — ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB`)
}

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  const code = await Bun.spawn(["tar", "-xzf", archivePath, "-C", destDir], {
    stdout: "inherit",
    stderr: "inherit",
  }).exited
  if (code !== 0) throw new Error(`tar falló con código ${code}`)
  await Bun.spawn(["rm", "-f", archivePath]).exited
}

async function extractZip(archivePath: string, destDir: string): Promise<void> {
  const code = await Bun.spawn(["unzip", "-q", archivePath, "-d", destDir], {
    stdout: "inherit",
    stderr: "inherit",
  }).exited
  if (code !== 0) throw new Error(`unzip falló con código ${code}`)
  await Bun.spawn(["rm", "-f", archivePath]).exited
}

/**
 * Instala Piper TTS en el directorio indicado.
 * Exportado para llamarse inline desde el gateway sin necesidad de un script externo.
 */
export async function runInstall(ttsRoot: string): Promise<void> {
  const BIN_DIR = join(ttsRoot, "bin")
  const VOICES_DIR = join(ttsRoot, "voices")

  mkdirSync(BIN_DIR, { recursive: true })
  mkdirSync(VOICES_DIR, { recursive: true })

  // ── Piper binary ──────────────────────────────────────────────────────────
  const platform = detectPlatform()
  const binaryName = getPiperBinaryName(platform)
  const binaryPath = join(BIN_DIR, binaryName)

  if (!existsSync(binaryPath)) {
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

    const piperSubdir = join(BIN_DIR, "piper")
    if (existsSync(piperSubdir)) {
      const tempDir = join(BIN_DIR, "_piper_tmp")
      renameSync(piperSubdir, tempDir)
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
  } else {
    log.info("Piper ya instalado, omitiendo descarga.")
  }

  // ── Voice model ───────────────────────────────────────────────────────────
  const modelPath = join(VOICES_DIR, `${DEFAULT_VOICE}.onnx`)
  const configPath = join(VOICES_DIR, `${DEFAULT_VOICE}.onnx.json`)

  if (!existsSync(modelPath) || !existsSync(configPath)) {
    log.info(`Descargando modelo de voz ${DEFAULT_VOICE}...`)
    await downloadFile(VOICE_URLS.model, modelPath)
    await downloadFile(VOICE_URLS.config, configPath)
    log.info(`Voz instalada en ${VOICES_DIR}`)
  } else {
    log.info("Modelo de voz ya instalado, omitiendo descarga.")
  }

  log.info("Hive TTS listo.")
}

// Ejecución directa: bun run src/install.ts
// @ts-ignore
if (import.meta.main) {
  const ttsRoot =
    process.env.HIVE_TTS_ROOT ??
    join(process.env.HIVE_HOME ?? join(homedir(), ".hive"), "tts")
  runInstall(ttsRoot).catch((err) => {
    log.error(`Hive TTS no pudo instalarse: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  })
}
