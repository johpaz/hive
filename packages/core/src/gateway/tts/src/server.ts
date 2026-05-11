#!/usr/bin/env bun
/**
 * Hive TTS Server
 * HTTP server local que expone Piper TTS como API REST
 * Puerto: 5500 (configurable con env TTS_PORT)
 *
 * GET  /health   → { ok: true, voice: string, voices: string[] }
 * POST /tts      → audio/wav binary
 * GET  /voices   → { voices: string[] }
 */

import { existsSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { detectPlatform, getPiperBinaryName, DEFAULT_VOICE } from "./detect.js"

const log = {
  info: (msg: string) => console.log(`[TTS] ${msg}`),
  warn: (msg: string) => console.warn(`[TTS] ${msg}`),
  error: (msg: string) => console.error(`[TTS] ${msg}`),
}

const TTS_ROOT =
  process.env.HIVE_TTS_ROOT ??
  join(process.env.HIVE_HOME ?? join(homedir(), ".hive"), "tts")
const BIN_DIR = join(TTS_ROOT, "bin")
const VOICES_DIR = join(TTS_ROOT, "voices")
const PORT = Number(process.env.TTS_PORT ?? 5500)
const DEFAULT_VOICE_ENV = process.env.TTS_VOICE ?? DEFAULT_VOICE

function getPiperPath(): string {
  const platform = detectPlatform()
  const binaryName = getPiperBinaryName(platform)
  const binaryPath = join(BIN_DIR, binaryName)

  if (!existsSync(binaryPath)) {
    throw new Error("Piper no instalado. Ejecuta: bun run src/install.ts")
  }
  return binaryPath
}

function listVoices(): string[] {
  if (!existsSync(VOICES_DIR)) return []
  return readdirSync(VOICES_DIR)
    .filter((f) => f.endsWith(".onnx"))
    .map((f) => f.replace(".onnx", ""))
}

async function synthesize(text: string, voice: string): Promise<ArrayBuffer> {
  const piperPath = getPiperPath()
  let modelPath = join(VOICES_DIR, `${voice}.onnx`)
  let configPath = join(VOICES_DIR, `${voice}.onnx.json`)

  if (!existsSync(modelPath)) {
    console.warn(`[TTS] Voz no encontrada: ${voice}. Usando por defecto: ${DEFAULT_VOICE}`);
    voice = DEFAULT_VOICE;
    modelPath = join(VOICES_DIR, `${voice}.onnx`);
    configPath = join(VOICES_DIR, `${voice}.onnx.json`);
    
    if (!existsSync(modelPath)) {
      throw new Error(`Ni siquiera la voz por defecto se encuentra: ${voice}`);
    }
  }

  // Leer configuración del modelo para obtener parámetros de inferencia
  let lengthScale = 0.95      // Más lento = más natural
  let noiseScale = 0.6        // Menos variación = más consistente
  let noiseW = 0.75           // Más suave = menos artefactos
  let sentenceSilence = 0.2   // Pausa entre frases para naturalidad

  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"))
      const inference = config.inference || {}

      // Usar valores del modelo con ajustes para mejorar naturalidad
      lengthScale = (inference.length_scale ?? 1) * 0.95
      noiseScale = (inference.noise_scale ?? 0.667) * 0.9
      noiseW = (inference.noise_w ?? 0.8) * 0.95
    } catch (err) {
      log.warn(`No se pudo leer configuración del modelo: ${err}`)
    }
  }

  // Sobrescribir con variables de entorno si existen
  lengthScale = Number(process.env.PIPER_LENGTH_SCALE ?? lengthScale)
  noiseScale = Number(process.env.PIPER_NOISE_SCALE ?? noiseScale)
  noiseW = Number(process.env.PIPER_NOISE_W ?? noiseW)
  sentenceSilence = Number(process.env.PIPER_SENTENCE_SILENCE ?? sentenceSilence)

  const args = [
    piperPath,
    "--model", modelPath,
    "--output-raw",
    "--length_scale", String(lengthScale),
    "--noise_scale", String(noiseScale),
    "--noise_w", String(noiseW),
    "--sentence_silence", String(sentenceSilence),
  ]

  const proc = Bun.spawn(
    args,
    {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    }
  )

  proc.stdin.write(new TextEncoder().encode(text))
  proc.stdin.end()

  const [audioBuffer, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    const errText = await new Response(proc.stderr).text()
    throw new Error(`Piper error (exit ${exitCode}): ${errText}`)
  }

  // --output-raw devuelve PCM 16-bit LE 22050Hz mono — envolver en WAV header
  return wrapInWav(audioBuffer, 22050, 1, 16)
}

function wrapInWav(
  pcm: ArrayBuffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): ArrayBuffer {
  const dataSize = pcm.byteLength
  const header = new ArrayBuffer(44)
  const view = new DataView(header)

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++)
      view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeStr(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, (sampleRate * channels * bitsPerSample) / 8, true)
  view.setUint16(32, (channels * bitsPerSample) / 8, true)
  view.setUint16(34, bitsPerSample, true)
  writeStr(36, "data")
  view.setUint32(40, dataSize, true)

  const wav = new Uint8Array(44 + dataSize)
  wav.set(new Uint8Array(header), 0)
  wav.set(new Uint8Array(pcm), 44)
  return wav.buffer
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

/**
 * Inicia el servidor TTS en-proceso.
 * Exportado para que el gateway pueda llamarlo directamente
 * sin necesidad de spawnar un subproceso externo.
 */
export function startTTSServer(opts?: { port?: number }): ReturnType<typeof Bun.serve> {
  const listenPort = opts?.port ?? PORT

  const server = Bun.serve({
    port: listenPort,
    async fetch(req) {
      const url = new URL(req.url)

      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS })
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return Response.json(
          { ok: true, voice: DEFAULT_VOICE_ENV, voices: listVoices() },
          { headers: CORS }
        )
      }

      if (req.method === "GET" && url.pathname === "/voices") {
        return Response.json({ voices: listVoices() }, { headers: CORS })
      }

      if (req.method === "POST" && url.pathname === "/tts") {
        let body: { text?: string; voice?: string }
        try {
          body = await req.json()
        } catch {
          return Response.json(
            { error: "Body JSON inválido" },
            { status: 400, headers: CORS }
          )
        }

        const { text, voice = DEFAULT_VOICE_ENV } = body

        if (!text || typeof text !== "string" || text.trim().length === 0) {
          return Response.json(
            { error: "Campo 'text' requerido" },
            { status: 400, headers: CORS }
          )
        }

        if (text.length > 2000) {
          return Response.json(
            { error: "Texto demasiado largo (máx 2000 chars)" },
            { status: 400, headers: CORS }
          )
        }

        try {
          const audio = await synthesize(text.trim(), voice)
          return new Response(audio, {
            headers: {
              ...CORS,
              "Content-Type": "audio/wav",
              "Content-Length": String(audio.byteLength),
            },
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : "Error interno"
          return Response.json({ error: message }, { status: 500, headers: CORS })
        }
      }

      return Response.json({ error: "Not found" }, { status: 404, headers: CORS })
    },
  })

  log.info(`Hive TTS Server escuchando en http://localhost:${listenPort}`)
  log.info(`Voz por defecto: ${DEFAULT_VOICE_ENV}`)
  log.info(`Voces disponibles: ${listVoices().join(", ") || "ninguna (ejecuta install.ts primero)"}`)
  return server
}

// Ejecución directa: bun run src/server.ts
// @ts-ignore
if (import.meta.main) {
  startTTSServer()
}
