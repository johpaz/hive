import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { installLlamaServer, downloadModel, listLocalModels, BIN_DIR, MODELS_DIR } from "../llm-local/downloader"
import { llamaManager, type ServerMode } from "../llm-local/manager"
import { getRecommendedModel } from "../llm-local/models"
import { detectGPU } from "../llm-local/detector"
// lmmManager se encarga de los procesos

// Datos de LLM en HIVE_HOME/llm/
const LLM_ROOT =
  process.env.HIVE_LLM_ROOT ??
  join(process.env.HIVE_HOME ?? join(homedir(), ".hive"), "llm-local")

const BIN_DIR_PATH = join(LLM_ROOT, "bin")
const MODELS_DIR_PATH = join(LLM_ROOT, "models")

let installing = false
let installLogs: string[] = []
let downloadingModelId: string | null = null

async function getInstalledStatus() {
  const { LLAMA_CPP_DEFAULT_VER } = await import("../llm-local/detector")
  const gpu = await detectGPU()
  const ext = process.platform === "win32" ? ".exe" : ""
  const binaryPath = join(BIN_DIR_PATH, `llama-${LLAMA_CPP_DEFAULT_VER}/llama-server${ext}`)
  const binaryExists = existsSync(binaryPath)
  const models = listLocalModels()
  const anyModelExists = models.some(m => m.downloaded)
  
  const activeServers = llamaManager.getStatus()
  const running = activeServers.length > 0
  
  return {
    gpu,
    binaryExists,
    anyModelExists,
    installed: binaryExists && anyModelExists,
    running,
    activeServers,
    models
  }
}

// Ya no usamos isRunning con fetch directo aquí, sino vía manager

export async function handleGetLocalLLMStatus(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  const status = await getInstalledStatus()
  return addCors(
    Response.json({ 
      ...status,
      installing,
      downloadingModelId
    }),
    req
  )
}

export async function handleGetLocalLLMLogs(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  const mode = new URL(req.url).searchParams.get("mode") as ServerMode || "TEXT"
  
  // Return an SSE stream instead of a normal JSON response
  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (data: any) => {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`))
      }
      
      // Send initial state
      sendEvent({ logs: installLogs.slice(-100), serverLogs: llamaManager.getLogs(mode).slice(-100), llmRoot: LLM_ROOT })

      // Create an interval to push new logs (or use EventEmitter if available)
      let lastInstallLogCount = installLogs.length
      let lastServerLogCount = llamaManager.getLogs(mode).length

      const interval = setInterval(() => {
        const currentInstallLogs = installLogs
        const currentServerLogs = llamaManager.getLogs(mode)
        
        let hasChanges = false
        const payload: any = {}
        
        if (currentInstallLogs.length > lastInstallLogCount) {
          payload.logs = currentInstallLogs.slice(lastInstallLogCount)
          lastInstallLogCount = currentInstallLogs.length
          hasChanges = true
        }
        
        if (currentServerLogs.length > lastServerLogCount) {
          payload.serverLogs = currentServerLogs.slice(lastServerLogCount)
          lastServerLogCount = currentServerLogs.length
          hasChanges = true
        }

        if (hasChanges) {
          sendEvent(payload)
        }
      }, 500) // Push changes every 500ms

      req.signal.addEventListener("abort", () => {
        clearInterval(interval)
        controller.close()
      })
    }
  })

  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  })
  
  return addCors(response, req)
}

export async function handleInstallLocalLLM(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  if (installing) {
    return addCors(Response.json({ started: false, reason: "Ya hay una instalación en curso" }), req)
  }

  installing = true
  installLogs = [`[${new Date().toISOString()}] Iniciando configuración de Local LLM...`]
  installLogs.push(`  LLM_ROOT: ${LLM_ROOT}`)

  // Background installation (solo binario, NO modelos)
  ;(async () => {
    try {
      installLogs.push("Detectando GPU...")
      const gpu = await detectGPU()
      installLogs.push(`GPU detectada: ${gpu.deviceName || 'CPU'} (${gpu.backend})`)
      
      installLogs.push("Instalando llama-server oficial...")
      await installLlamaServer()
      installLogs.push(`[${new Date().toISOString()}] ✓ llama-server instalado`)
      installLogs.push(`[${new Date().toISOString()}] Ahora descarga un modelo desde la sección de modelos para empezar a usar el LLM local.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      installLogs.push(`[error] Falló la instalación: ${msg}`)
      console.error(`[llm-local install] Error:`, err)
    } finally {
      installing = false
    }
  })()

  return addCors(Response.json({ started: true }), req)
}

export async function handleDownloadLLMModel(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  let body: { modelId?: any }
  try {
    body = await req.json()
  } catch {
    return addCors(Response.json({ error: "Body JSON inválido" }, { status: 400 }), req)
  }

  const { modelId } = body
  if (!modelId) {
    return addCors(Response.json({ error: "modelId requerido" }, { status: 400 }), req)
  }

  if (downloadingModelId) {
    return addCors(Response.json({ error: "Ya hay una descarga en curso" }, { status: 409 }), req)
  }

  downloadingModelId = modelId
  installLogs.push(`[${new Date().toISOString()}] Iniciando descarga de modelo: ${modelId}`)

  // Background download
  ;(async () => {
    try {
      await downloadModel(modelId, (d, t) => {
        // Opcional: Podríamos emitir eventos por WS si quisiéramos progreso real en UI
      })
      installLogs.push(`✓ Modelo ${modelId} descargado exitosamente`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      installLogs.push(`[error] Error descargando ${modelId}: ${msg}`)
    } finally {
      downloadingModelId = null
    }
  })()

  return addCors(Response.json({ started: true }), req)
}

export async function handleStartLocalLLM(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  let body: { mode?: ServerMode; modelId?: string } = {}
  try {
    body = await req.json()
  } catch { /* ignore if no body */ }

  const mode = body.mode || "TEXT"
  const modelId = body.modelId || getRecommendedModel(mode.toLowerCase() as any)

  const status = await getInstalledStatus()
  if (!status.installed && !status.binaryExists) {
     return addCors(
      Response.json({ started: false, reason: "LLM no está instalado (binario faltante)." }, { status: 400 }),
      req
    )
  }

  try {
    installLogs.push(`[llm-server] Iniciando servidor en modo ${mode} con modelo ${modelId}...`)
    await llamaManager.start(mode, modelId as any)
    installLogs.push(`[llm-server] Servidor ${mode} iniciado correctamente.`)
    return addCors(Response.json({ started: true, mode }), req)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    installLogs.push(`[error] Servidor LLM falló al iniciar: ${msg}`)
    return addCors(Response.json({ started: false, reason: msg }), req)
  }
}

export async function handleStopLocalLLM(
  req: Request,
  addCors: (r: Response, req: Request) => Response
): Promise<Response> {
  let body: { mode?: ServerMode } = {}
  try {
    body = await req.json()
  } catch { /* ignore */ }

  if (body.mode) {
    llamaManager.stop(body.mode)
  } else {
    llamaManager.stopAll()
  }
  
  return addCors(Response.json({ stopped: true }), req)
}

/**
 * Verifica el estado del LLM local al iniciar el gateway.
 * NO auto-inicia el servidor ni descarga nada — el usuario debe hacerlo manualmente.
 */
export async function initializeLocalLLM() {
  try {
    const status = await getInstalledStatus()
    if (status.binaryExists) {
      console.log(`[llm-local] ✓ Binario llama-server encontrado.`)
      if (status.anyModelExists) {
        console.log(`[llm-local] ✓ Modelos disponibles: ${status.models.filter(m => m.downloaded).map(m => m.id).join(", ")}`)
        console.log(`[llm-local] ℹ️ Servidor NO auto-iniciado. Usa la UI para iniciar cuando lo necesites.`)
      } else {
        console.log(`[llm-local] ⚠️ No hay modelos descargados. Descarga uno desde la UI.`)
      }
    } else {
      console.log(`[llm-local] ℹ️ llama-server no instalado. Instálalo desde la UI si deseas usar LLM local.`)
    }
  } catch (err) {
    console.error(`[llm-local] Error verificando estado: ${err instanceof Error ? err.message : String(err)}`)
  }
}
