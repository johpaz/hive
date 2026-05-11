/**
 * Hive Local LLM — WebSocket Server
 
 */

import type { ServerWebSocket } from "bun"
import { existsSync } from "fs"
import { llamaManager, type ServerMode } from "./manager"
import type { ModelId } from "./downloader"

interface WSData {
  sessionId: string
}

interface GenerateRequest {
  type: "generate"
  prompt: string
  model: ModelId
  imagePath?: string
  audioPath?: string
  nPredict?: number
}

interface DownloadRequest {
  type: "download"
  model: ModelId
}

export type LLMMessage = GenerateRequest | DownloadRequest

const sessions = new Map<string, ServerWebSocket<WSData>>()

export async function handleLLMWebSocket(
  ws: ServerWebSocket<WSData>,
  message: string
): Promise<void> {
  let req: LLMMessage
  try {
    req = JSON.parse(message)
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "JSON inválido" }))
    return
  }

  if (req.type === "download") {
    await handleDownload(ws, req)
    return
  }

  if (req.type === "generate") {
    await handleGenerate(ws, req)
    return
  }

  ws.send(JSON.stringify({ type: "error", message: `Tipo desconocido: ${(req as any).type}` }))
}

async function handleDownload(
  ws: ServerWebSocket<WSData>,
  req: DownloadRequest
): Promise<void> {
  const { downloadModel, isModelDownloaded } = await import("./downloader")

  if (isModelDownloaded(req.model)) {
    ws.send(JSON.stringify({ type: "download_progress", model: req.model, percent: 100, done: true }))
    return
  }

  try {
    await downloadModel(req.model, (downloaded, total) => {
      const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0
      ws.send(JSON.stringify({
        type: "download_progress",
        model: req.model,
        percent,
        downloaded,
        total,
        done: false,
      }))
    })

    ws.send(JSON.stringify({ type: "download_progress", model: req.model, percent: 100, done: true }))
  } catch (err) {
    ws.send(JSON.stringify({
      type: "error",
      message: err instanceof Error ? err.message : "Error descargando modelo",
    }))
  }
}

async function handleGenerate(
  ws: ServerWebSocket<WSData>,
  req: GenerateRequest
): Promise<void> {
  try {
    // Determinar modo (por ahora simplificado a TEXT, pero podríamos soportar IMAGE/AUDIO si el req lo pide)
    const mode: ServerMode = req.imagePath ? "IMAGE" : (req.audioPath ? "AUDIO" : "TEXT")

    // Asegurar que el servidor esté corriendo
    const server = await llamaManager.start(mode, req.model)

    ws.send(JSON.stringify({ type: "status", message: `Generando vía llama-server (${mode})...` }))

    // Llamar a la API de llama-server (formato OpenAI)
    const response = await fetch(`http://localhost:${server.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        messages: [{ role: "user", content: req.prompt }],
        stream: true,
        max_tokens: req.nPredict || 512,
      })
    })

    if (!response.ok) {
      throw new Error(`llama-server respondió ${response.status}: ${await response.text()}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error("No se pudo obtener el reader de la respuesta")

    const decoder = new TextDecoder()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split("\n")

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith("data: ")) continue

          const dataStr = trimmed.slice(6)
          if (dataStr === "[DONE]") break

          try {
            const data = JSON.parse(dataStr)
            const token = data.choices[0]?.delta?.content
            if (token) {
              ws.send(JSON.stringify({ type: "token", text: token }))
            }
          } catch { /* ignore parse errors in chunks */ }
        }
      }
    } finally {
      reader.releaseLock()
    }

    ws.send(JSON.stringify({ type: "done" }))
  } catch (err) {
    ws.send(JSON.stringify({
      type: "error",
      message: err instanceof Error ? err.message : "Error en generación",
    }))
  }
}

/** HTTP handler para status de modelos */
export async function handleLLMStatus(): Promise<Response> {
  const { listLocalModels, isModelDownloaded } = await import("./downloader")
  const { detectGPU } = await import("./detector")

  const gpu = await detectGPU()
  const models = listLocalModels()

  return Response.json({
    ok: true,
    gpu: {
      backend: gpu.backend,
      deviceName: gpu.deviceName,
      platform: gpu.platform,
    },
    models,
  })
}
