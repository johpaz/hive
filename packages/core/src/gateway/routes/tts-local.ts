import { existsSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { TTS_MODELS, getModelById } from "../../../../tts/src/models.ts"

// import.meta.dir = .../packages/core/src/gateway/routes → subir 4 niveles → packages/
// Confiable independientemente del cwd del gateway
const TTS_ROOT = join(import.meta.dir, "../../../../tts")
const BIN_PATH = join(TTS_ROOT, "bin", process.platform === "win32" ? "piper.exe" : "piper")
const VOICES_DIR = join(TTS_ROOT, "voices")
const TTS_PORT = Number(process.env.TTS_PORT ?? 5500)

let ttsProcess: ReturnType<typeof Bun.spawn> | null = null
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

  const installScript = join(TTS_ROOT, "src", "install.ts")
  if (!existsSync(installScript)) {
    return addCors(
      Response.json({
        started: false,
        reason: `Script no encontrado: ${installScript}. Verifica que packages/tts existe.`,
      }, { status: 500 }),
      req
    )
  }

  installing = true
  installLogs = [`[${new Date().toISOString()}] Iniciando instalación de Piper...`]
  installLogs.push(`  TTS_ROOT: ${TTS_ROOT}`)
  installLogs.push(`  Script: ${installScript}`)
  installLogs.push(`  Bun: ${process.execPath}`)

  // Usar process.execPath (ruta absoluta al binario bun actual) — confiable en cualquier entorno
  const proc = Bun.spawn([process.execPath, installScript], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: TTS_ROOT,
  })

  // Capturar stdout en background
  ;(async () => {
    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const line = decoder.decode(value).trim()
      if (line) installLogs.push(line)
    }
  })()

  // Capturar stderr en background
  ;(async () => {
    const reader = proc.stderr.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const line = decoder.decode(value).trim()
      if (line) {
        installLogs.push(`[stderr] ${line}`)
        console.error(`[hive-tts install] ${line}`)
      }
    }
  })()

  proc.exited.then((code) => {
    installing = false
    installLogs.push(`[${new Date().toISOString()}] Proceso finalizado con código ${code}`)
    if (code !== 0) console.error(`[hive-tts install] Falló con código ${code}`)
  }).catch((err) => {
    installing = false
    installLogs.push(`[error] ${err}`)
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

  const serverScript = join(TTS_ROOT, "src", "server.ts")
  ttsProcess = Bun.spawn([process.execPath, serverScript], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TTS_PORT: String(TTS_PORT) },
    cwd: TTS_ROOT,
  })

  // Capturar stderr para logs de error
  ;(async () => {
    const reader = ttsProcess!.stderr.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const line = decoder.decode(value).trim()
      if (line) {
        installLogs.push(`[tts-server] ${line}`)
        console.error(`[tts-server] ${line}`)
      }
    }
  })()

  // Esperar hasta 3s a que el server levante
  for (let i = 0; i < 6; i++) {
    await Bun.sleep(500)
    if (await isRunning()) break
  }

  const running = await isRunning()
  
  // Si no inició, capturar el exit code para debugging
  if (!running) {
    const exitCode = await ttsProcess.exited
    console.error(`[tts-server] Falló al iniciar, exit code: ${exitCode}`)
    installLogs.push(`[error] Servidor TTS falló al iniciar (código ${exitCode})`)
  }
  
  return addCors(Response.json({ started: running }), req)
}

export async function handleStopLocalTTS(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  if (ttsProcess) {
    ttsProcess.kill()
    ttsProcess = null
  } else {
    try {
      Bun.spawn(["pkill", "-f", "tts/src/server.ts"])
    } catch {
      // pkill no disponible en Windows
    }
  }

  return addCors(Response.json({ stopped: true }), req)
}

async function ensureTTSRunning(): Promise<boolean> {
  if (await isRunning()) return true
  if (!isInstalled().installed) return false

  const serverScript = join(TTS_ROOT, "src", "server.ts")
  if (!existsSync(serverScript)) return false

  ttsProcess = Bun.spawn([process.execPath, serverScript], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TTS_PORT: String(TTS_PORT) },
    cwd: TTS_ROOT,
  })

  for (let i = 0; i < 10; i++) {
    await Bun.sleep(500)
    if (await isRunning()) return true
  }
  return false
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
