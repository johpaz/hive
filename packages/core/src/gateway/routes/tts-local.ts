import { existsSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { TTS_MODELS, getModelById } from "../tts/src/models.ts"
import { runInstall } from "../tts/src/install.ts"
import { startTTSServer } from "../tts/src/server.ts"

// Datos de TTS en HIVE_HOME/tts/ — funciona igual en dev, npm global y Docker
const TTS_ROOT =
  process.env.HIVE_TTS_ROOT ??
  join(process.env.HIVE_HOME ?? join(homedir(), ".hive"), "tts")
const BIN_PATH = join(TTS_ROOT, "bin", process.platform === "win32" ? "piper.exe" : "piper")
const VOICES_DIR = join(TTS_ROOT, "voices")
const TTS_PORT = Number(process.env.TTS_PORT ?? 5500)

let ttsServer: ReturnType<typeof Bun.serve> | null = null
let installing = false
let installLogs: string[] = []
let downloadingModelId: string | null = null
let downloadLogs: string[] = []

function isInstalled(): { piperExists: boolean; voiceExists: boolean; installed: boolean } {
  const piperExists = existsSync(BIN_PATH)
  const voiceExists = getInstalledVoices().length > 0
  return { piperExists, voiceExists, installed: piperExists && voiceExists }
}

function getInstalledVoices(): string[] {
  if (!existsSync(VOICES_DIR)) return []
  const files = readdirSync(VOICES_DIR)
  return files
    .filter((f) => f.endsWith(".onnx"))
    .map((f) => f.replace(".onnx", ""))
}

async function isRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${TTS_PORT}/health`, {
      signal: AbortSignal.timeout(600),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function handleGetLocalTTSStatus(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  const { piperExists, voiceExists, installed } = isInstalled()
  const running = await isRunning()
  const voices = getInstalledVoices()
  return addCors(
    Response.json({ 
      installed, 
      piperExists, 
      voiceExists, 
      running, 
      port: TTS_PORT, 
      installing,
      voices 
    }),
    req
  )
}

export async function handleGetLocalTTSLogs(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  return addCors(
    Response.json({ logs: installLogs.slice(-100), ttsRoot: TTS_ROOT, bunPath: process.execPath }),
    req
  )
}

export async function handleInstallLocalTTS(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  if (installing) {
    return addCors(Response.json({ started: false, reason: "Ya hay una instalación en curso" }), req)
  }
  if (isInstalled().installed) {
    return addCors(Response.json({ started: false, reason: "Piper ya está instalado" }), req)
  }

  installing = true
  installLogs = [`[${new Date().toISOString()}] Iniciando instalación de Piper...`]
  installLogs.push(`  TTS_ROOT: ${TTS_ROOT}`)

  // Interceptar console.log de runInstall para capturar en installLogs
  const origLog = console.log
  const origWarn = console.warn
  console.log = (...args) => { installLogs.push(args.join(" ")); origLog(...args) }
  console.warn = (...args) => { installLogs.push(`[warn] ${args.join(" ")}`); origWarn(...args) }

  runInstall(TTS_ROOT)
    .then(() => {
      installLogs.push(`[${new Date().toISOString()}] Instalación completada`)
    })
    .catch((err) => {
      installLogs.push(`[error] ${err instanceof Error ? err.message : String(err)}`)
      console.error(`[hive-tts install] Falló: ${err}`)
    })
    .finally(() => {
      installing = false
      console.log = origLog
      console.warn = origWarn
    })

  return addCors(Response.json({ started: true }), req)
}

export async function handleStartLocalTTS(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  if (await isRunning()) {
    return addCors(Response.json({ started: false, reason: "El servidor TTS ya está ejecutándose" }), req)
  }
  if (!isInstalled().installed) {
    return addCors(
      Response.json({ started: false, reason: "Piper no está instalado. Instálalo primero." }, { status: 400 }),
      req
    )
  }

  try {
    ttsServer = startTTSServer({ port: TTS_PORT })
    installLogs.push(`[tts-server] Servidor TTS iniciado en puerto ${TTS_PORT}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[tts-server] Falló al iniciar: ${msg}`)
    installLogs.push(`[error] Servidor TTS falló al iniciar: ${msg}`)
    return addCors(Response.json({ started: false, reason: msg }), req)
  }

  // Esperar hasta 3s a que el server levante
  for (let i = 0; i < 6; i++) {
    await Bun.sleep(500)
    if (await isRunning()) break
  }

  const running = await isRunning()
  return addCors(Response.json({ started: running }), req)
}

export async function handleStopLocalTTS(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  if (ttsServer) {
    ttsServer.stop(true)
    ttsServer = null
  }

  return addCors(Response.json({ stopped: true }), req)
}

async function ensureTTSRunning(): Promise<boolean> {
  if (await isRunning()) return true
  if (!isInstalled().installed) return false

  try {
    ttsServer = startTTSServer({ port: TTS_PORT })
  } catch {
    return false
  }

  for (let i = 0; i < 10; i++) {
    await Bun.sleep(500)
    if (await isRunning()) return true
  }
  return false
}

export async function initializeLocalTTS() {
  const { installed } = isInstalled()
  if (installed) {
    const running = await isRunning()
    if (!running) {
      try {
        ttsServer = startTTSServer({ port: TTS_PORT })
        console.log(`[tts-server] Servidor TTS auto-iniciado en puerto ${TTS_PORT}`)
      } catch (err) {
        console.error(`[tts-server] Falló el auto-inicio: ${err instanceof Error ? err.message : String(err)}`)
      }
    } else {
      console.log(`[tts-server] Servidor TTS ya está ejecutándose en puerto ${TTS_PORT}`)
    }
  }
}

// Proxy de síntesis para el browser — evita exponer el puerto TTS directamente
export async function handleSpeakLocalTTS(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  let body: { text?: string; voice?: string }
  try {
    body = await req.json()
  } catch {
    return addCors(Response.json({ error: "Body JSON inválido" }, { status: 400 }), req)
  }

  const { text, voice } = body
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return addCors(Response.json({ error: "'text' requerido" }, { status: 400 }), req)
  }

  const running = await ensureTTSRunning()
  if (!running) {
    return addCors(
      Response.json({ error: "Piper TTS no disponible" }, { status: 503 }),
      req
    )
  }

  try {
    const res = await fetch(`http://localhost:${TTS_PORT}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim(), voice }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "TTS error" }))
      return addCors(Response.json(err, { status: 503 }), req)
    }
    const wav = await res.arrayBuffer()
    return addCors(
      new Response(wav, {
        headers: {
          "Content-Type": "audio/wav",
          "Content-Length": String(wav.byteLength),
        },
      }),
      req
    )
  } catch {
    return addCors(
      Response.json({ error: "Error al sintetizar con Piper" }, { status: 503 }),
      req
    )
  }
}

// ─── Gestión de modelos ──────────────────────────────────────────────────────

export async function handleGetAvailableModels(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  const installedVoices = getInstalledVoices()
  const modelsWithStatus = TTS_MODELS.map((model) => ({
    ...model,
    installed: installedVoices.includes(model.id),
  }))
  return addCors(Response.json({ models: modelsWithStatus }), req)
}

export async function handleGetInstalledVoices(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  const voices = getInstalledVoices().map((id) => {
    const model = getModelById(id)
    
    // Leer configuración de inferencia del modelo
    let inferenceConfig = { length_scale: 1, noise_scale: 0.667, noise_w: 0.8 }
    const configPath = join(VOICES_DIR, `${id}.onnx.json`)
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, "utf-8"))
        inferenceConfig = { ...inferenceConfig, ...config.inference }
      } catch {
        // Ignore
      }
    }
    
    return {
      id,
      name: model?.name || id,
      language: model?.language || "unknown",
      inference: inferenceConfig,
    }
  })
  return addCors(Response.json({ voices }), req)
}

export async function handleDownloadModel(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  let body: { modelId?: string }
  try {
    body = await req.json()
  } catch {
    return addCors(Response.json({ error: "Body JSON inválido" }, { status: 400 }), req)
  }

  const { modelId } = body
  if (!modelId || typeof modelId !== "string") {
    return addCors(Response.json({ error: "modelId requerido" }, { status: 400 }), req)
  }

  const model = getModelById(modelId)
  if (!model) {
    return addCors(Response.json({ error: `Modelo no encontrado: ${modelId}` }, { status: 404 }), req)
  }

  if (downloadingModelId) {
    return addCors(
      Response.json({ 
        started: false, 
        reason: `Ya hay una descarga en curso: ${downloadingModelId}` 
      }, { status: 409 }),
      req
    )
  }

  // Verificar si ya está instalado
  const installedVoices = getInstalledVoices()
  if (installedVoices.includes(modelId)) {
    return addCors(
      Response.json({ started: false, reason: "El modelo ya está instalado" }, { status: 409 }),
      req
    )
  }

  downloadingModelId = modelId
  downloadLogs = [`[${new Date().toISOString()}] Iniciando descarga de ${model.name}...`]

  // Ejecutar descarga en background
  ;(async () => {
    try {
      const modelDest = join(VOICES_DIR, `${modelId}.onnx`)
      const configDest = join(VOICES_DIR, `${modelId}.onnx.json`)

      downloadLogs.push(`  Descargando modelo: ${model.size}`)
      downloadLogs.push(`  URL: ${model.modelUrl}`)

      // Descargar modelo
      const modelRes = await fetch(model.modelUrl)
      if (!modelRes.ok) {
        throw new Error(`HTTP ${modelRes.status} al descargar modelo`)
      }
      const modelBuf = await modelRes.arrayBuffer()
      await Bun.write(modelDest, modelBuf)
      downloadLogs.push(`  ✓ Modelo descargado (${(modelBuf.byteLength / 1024 / 1024).toFixed(1)} MB)`)

      // Descargar config
      downloadLogs.push(`  Descargando configuración...`)
      const configRes = await fetch(model.configUrl)
      if (!configRes.ok) {
        throw new Error(`HTTP ${configRes.status} al descargar config`)
      }
      const configBuf = await configRes.arrayBuffer()
      await Bun.write(configDest, configBuf)
      downloadLogs.push(`  ✓ Configuración descargada`)

      downloadLogs.push(`[${new Date().toISOString()}] ${model.name} instalado exitosamente`)
    } catch (err) {
      downloadLogs.push(`[error] ${err instanceof Error ? err.message : String(err)}`)
      console.error(`[hive-tts download] Error:`, err)
    } finally {
      downloadingModelId = null
    }
  })()

  return addCors(Response.json({ started: true, modelId }), req)
}

export async function handleGetDownloadLogs(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  return addCors(
    Response.json({ 
      logs: downloadLogs, 
      downloading: downloadingModelId !== null,
      currentModelId: downloadingModelId 
    }),
    req
  )
}
