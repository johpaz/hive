/**
 * Hive Local LLM — Server Manager
 * Gestiona procesos persistentes de llama-server
 */

import { spawn, type Subprocess } from "bun"
import { getModelConfig, buildLlamaServerArgs, type ModelConfig } from "./models"
import { type ModelId } from "./downloader"
import { findLlamaServerBinary } from "./downloader"
import { logger } from "../../utils/logger"

const log = logger.child("llama-manager")

export type ServerMode = "TEXT" | "IMAGE" | "AUDIO"

interface ManagedServer {
  mode: ServerMode
  port: number
  process: Subprocess

  modelId: ModelId
  startedAt: number
}

class LlamaServerManager {
  private servers = new Map<ServerMode, ManagedServer>()
  private logs = new Map<ServerMode, string[]>()

  async start(mode: ServerMode, modelId: ModelId): Promise<ManagedServer> {
    const existing = this.servers.get(mode)
    if (existing) {
      if (existing.process.killed) {
        this.servers.delete(mode)
      } else {
        return existing
      }
    }

    // Solo 1 modo a la vez para evitar Out of Memory (VRAM compartida)
    this.stopAll()
    await Bun.sleep(1000) // Dar tiempo a liberar la VRAM y puertos

    const port = this.getPortForMode(mode)
    // NO auto-descargar: verificar que el binario ya exista
    const binaryPath = await findLlamaServerBinary()
    if (!binaryPath) {
      throw new Error(
        "llama-server no está instalado. Ve a Configuración > LLM Local y haz clic en 'Instalar' primero."
      )
    }
    const config = getModelConfig(modelId, port)

    if ((mode === "IMAGE" || mode === "AUDIO") && !config.mmprojPath) {
      throw new Error(`El modo ${mode} requiere el proyector de visión (mmproj). Por favor, descárgalo primero.`)
    }

    const args = buildLlamaServerArgs(config, mode)

    log.info(`Iniciando llama-server para modo ${mode} en puerto ${port}...`)
    
    const proc = Bun.spawn([binaryPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        LD_LIBRARY_PATH: `${require("path").dirname(binaryPath)}:${process.env.LD_LIBRARY_PATH || ""}`,
        GGML_VULKAN_CHECK_RESULTS: "0",
        GGML_VULKAN_DEBUG: "0",
      },
    })

    const server: ManagedServer = {
      mode,
      port,
      process: proc,
      modelId,
      startedAt: Date.now(),
    }

    this.servers.set(mode, server)
    this.logs.set(mode, [])

    // Capturar logs
    this.captureLogs(mode, proc)

    // Esperar a que el servidor esté listo (health check)
    const ready = await this.waitForReady(port)
    if (!ready) {
      this.stop(mode)
      throw new Error(`Servidor ${mode} no respondió en puerto ${port} tras iniciar.`)
    }

    return server
  }

  stop(mode: ServerMode): void {
    const server = this.servers.get(mode)
    if (server) {
      server.process.kill()
      this.servers.delete(mode)
      log.info(`Servidor ${mode} detenido.`)
    }
  }

  stopAll(): void {
    for (const mode of this.servers.keys()) {
      this.stop(mode)
    }
  }

  getStatus() {
    const status: any[] = []
    for (const [mode, server] of this.servers.entries()) {
      status.push({
        mode,
        port: server.port,
        modelId: server.modelId,
        uptime: Math.floor((Date.now() - server.startedAt) / 1000),
        pid: server.process.pid,
      })
    }
    return status
  }

  getLogs(mode: ServerMode): string[] {
    return this.logs.get(mode) || []
  }

  private getPortForMode(mode: ServerMode): number {
    switch (mode) {
      case "TEXT": return 8081
      case "IMAGE": return 8082
      case "AUDIO": return 8083
      default: return 8081
    }
  }

  private async waitForReady(port: number, retries = 20): Promise<boolean> {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(500),
        })
        if (res.ok) return true
      } catch {
        // next retry
      }
      await Bun.sleep(500)
    }
    return false
  }

  private async captureLogs(mode: ServerMode, proc: Subprocess) {
    if (!proc.stderr || typeof proc.stderr === "number") {
      log.warn(`No se pudo capturar logs para ${mode}: stderr no es un stream.`)
      return
    }

    const reader = proc.stderr.getReader()
    const decoder = new TextDecoder()
    const logs = this.logs.get(mode)!

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        const lines = text.split("\n")
        for (const line of lines) {
          if (line.trim()) {
            logs.push(line.trim())
            if (logs.length > 500) logs.shift()
            // Logear errores críticos al logger principal
            if (line.includes("error") || line.includes("FAILED")) {
              log.error(`[${mode}] ${line.trim()}`)
            }
          }
        }
      }
    } catch (e) {
      log.error(`Error capturando logs de ${mode}: ${e}`)
    }
  }
}

export const llamaManager = new LlamaServerManager()
