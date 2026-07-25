import { col } from "../../storage/hive.ts"
import { getUsageStats, hourBucket } from "../../storage/usage.ts"
import type { ActivityRollupDoc } from "../../storage/collections.ts"
import { loadConfig } from "../../config/loader.ts"
import { sessionManager } from "../session.ts"
import { getRecentMessageCount } from "../../agent/conversation-store.ts"
import { cpus } from "node:os"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import pkg from "../../../../../package.json"

const CURRENT_VERSION = pkg.version

export interface VersionInfo {
  current: string
  latest?: string
  status: "up-to-date" | "update-available" | "checking" | "error"
  error?: string
  installationType?: "docker" | "binary" | "npm" | "bun"
}

/**
 * Detecta el tipo de instalación de Hive
 */
function detectInstallationType(): "docker" | "binary" | "npm" | "bun" {
  // Docker: existe el archivo .dockerenv o el path contiene /.docker
  if (process.env.HIVE_DOCKER === "true" || process.env.RUNNING_IN_DOCKER === "true") {
    return "docker"
  }
  
  // Verificar si hay archivo .dockerenv (solo Linux)
  try {
    if (require("fs").existsSync("/.dockerenv")) {
      return "docker"
    }
  } catch {
    // Ignorar error en sistemas que no soportan require
  }
  
  // Bun: process.execPath contiene "bun"
  if (process.execPath?.includes("bun")) {
    return "bun"
  }
  
  // npm: las variables de entorno de npm
  if (process.env.npm_config_global_prefix) {
    return "npm"
  }
  
  // Por defecto, asumir binario standalone
  return "binary"
}

/**
 * Obtiene la versión más reciente desde npm registry
 */
async function getLatestVersionFromNpm(): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    
    const response = await fetch("https://registry.npmjs.org/@johpaz/hive-agents/latest", {
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    })
    
    clearTimeout(timeout)
    
    if (!response.ok) {
      return null
    }
    
    const data = await response.json()
    return data.version
  } catch (error) {
    console.error("[Version] Error fetching from npm:", (error as Error).message)
    return null
  }
}

/**
 * Obtiene la versión más reciente desde GitHub Releases
 */
async function getLatestVersionFromGitHub(): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    
    const response = await fetch("https://api.github.com/repos/johpaz/hive/releases/latest", {
      signal: controller.signal,
      headers: { 
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Hive-Version-Checker"
      }
    })
    
    clearTimeout(timeout)
    
    if (!response.ok) {
      return null
    }
    
    const data = await response.json()
    // Remover prefijo "v" si existe (ej: "v1.7.15" -> "1.7.15")
    return data.tag_name?.replace(/^v/, "") || null
  } catch (error) {
    console.error("[Version] Error fetching from GitHub:", (error as Error).message)
    return null
  }
}

/**
 * Compara dos versiones semánticas
 * Retorna: 1 si v1 > v2, -1 si v1 < v2, 0 si son iguales
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split(".").map(Number)
  const parts2 = v2.split(".").map(Number)
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const n1 = parts1[i] || 0
    const n2 = parts2[i] || 0
    
    if (n1 > n2) return 1
    if (n1 < n2) return -1
  }
  
  return 0
}

/**
 * Handler para obtener información de versión
 */
export async function handleGetVersion(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  const installationType = detectInstallationType()
  
  // Responder inmediatamente con la versión actual y estado "checking"
  let versionInfo: VersionInfo = {
    current: CURRENT_VERSION,
    status: "checking",
    installationType
  }
  
  // Siempre verificar en npm registry (es donde se publica @johpaz/hive-agents)
  // GitHub Releases solo como fallback si npm falla
  const latest = await getLatestVersionFromNpm()
    .then(v => v ?? getLatestVersionFromGitHub())
  
  if (latest) {
    const isUpdateAvailable = compareVersions(latest, CURRENT_VERSION) > 0
    versionInfo = {
      current: CURRENT_VERSION,
      latest,
      status: isUpdateAvailable ? "update-available" : "up-to-date",
      installationType
    }
  } else {
    versionInfo = {
      current: CURRENT_VERSION,
      status: "error",
      error: "No se pudo verificar la última versión. Verifica tu conexión a internet.",
      installationType
    }
  }
  
  return addCorsHeaders(Response.json(versionInfo), req)
}

/**
 * Handler para triggerar una actualización
 */
export async function handleTriggerUpdate(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  const installationType = detectInstallationType()
  
  try {
    let command: string[]
    let message: string
    
    switch (installationType) {
      case "docker":
        // Docker: el usuario debe ejecutar docker compose pull && docker compose up -d
        return addCorsHeaders(Response.json({
          success: false,
          error: "En Docker, ejecuta manualmente: docker compose pull && docker compose up -d",
          instructions: [
            "1. Abre una terminal en el directorio de Hive",
            "2. Ejecuta: docker compose pull",
            "3. Luego ejecuta: docker compose up -d",
            "4. Recarga esta página para ver la nueva versión"
          ]
        }), req)
        
      case "bun":
        command = ["bun", "install", "-g", "@johpaz/hive-agents@latest"]
        message = "Actualizando Hive desde npm..."
        break
        
      case "npm":
        command = ["npm", "install", "-g", "@johpaz/hive-agents@latest"]
        message = "Actualizando Hive desde npm..."
        break
        
      case "binary":
        return addCorsHeaders(Response.json({
          success: false,
          error: "Para actualizar el binario, descarga la última versión desde https://github.com/johpaz/hive/releases/latest",
          instructions: [
            "1. Visita https://github.com/johpaz/hive/releases/latest",
            "2. Descarga el binario para tu sistema operativo",
            "3. Reemplaza el archivo existente",
            "4. Ejecuta: hive start"
          ]
        }), req)
        
      default:
        return addCorsHeaders(Response.json({
          success: false,
          error: "Tipo de instalación no reconocido"
        }), req)
    }
    
    // Ejecutar comando de actualización
    const proc = Bun.spawn(command, {
      stdout: "pipe",
      stderr: "pipe",
    })
    
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited
    ])
    
    if (exitCode === 0) {
      return addCorsHeaders(Response.json({
        success: true,
        message: "Hive actualizado correctamente. Reinicia el gateway para aplicar los cambios.",
        output: stdout || stderr,
        instructions: [
          "1. Ejecuta: hive stop",
          "2. Luego ejecuta: hive start",
          "3. Recarga esta página para ver la nueva versión"
        ]
      }), req)
    } else {
      return addCorsHeaders(Response.json({
        success: false,
        error: "Error durante la actualización",
        output: stderr || stdout
      }), req)
    }
  } catch (error) {
    return addCorsHeaders(Response.json({
      success: false,
      error: (error as Error).message
    }), req)
  }
}

// CPU delta sampling — process.cpuUsage() is cumulative; passing the previous
// sample back in returns the diff since that call, which process.cpuUsage()
// computes for us.
const numCores = cpus().length || 1
let lastCpuSample = process.cpuUsage()
let lastCpuSampleTime = Date.now()

export function getSystemStats(startTime: number) {
  const mem = process.memoryUsage()
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000)
  const uptimeStr = new Date(uptimeSeconds * 1000).toISOString().substr(11, 8)

  const now = Date.now()
  const elapsedMs = now - lastCpuSampleTime
  const usage = process.cpuUsage(lastCpuSample)
  lastCpuSample = process.cpuUsage()
  lastCpuSampleTime = now
  const cpuPercent = elapsedMs > 0
    ? Math.round(((usage.user + usage.system) / 1000 / elapsedMs / numCores) * 100 * 100) / 100
    : 0

  return {
    cpu: cpuPercent,
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024), // MB
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024), // MB
      heapPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100 * 100) / 100,
      external: Math.round((mem.external || 0) / 1024 / 1024), // MB
    },
    uptime: uptimeStr,
    connections: sessionManager.list().length,
    cores: numCores,
    recentMessages: getRecentMessageCount(),
  }
}

export async function handleGetActivityStats(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const hours = parseInt(url.searchParams.get("hours") || "12", 10)

  // Get message counts per hour from the activityRollups collection
  const now = Date.now()
  const rollupsCol = await col<ActivityRollupDoc>("activityRollups")

  const buckets: string[] = []
  for (let t = now - hours * 3600_000; t <= now; t += 3600_000) {
    buckets.push(hourBucket(t))
  }

  const entries = await Promise.all(buckets.map((id) => rollupsCol.get(id)))
  const activityData = entries
    .map((e, i) => e ? { time: `${buckets[i].slice(0, 10)} ${buckets[i].slice(11, 13)}:00`, count: e.doc.messageCount } : null)
    .filter((x): x is { time: string; count: number } => x !== null)

  return addCorsHeaders(Response.json(activityData), req)
}

export async function handleGetSystemStats(req: Request, addCorsHeaders: (r: Response, req: Request) => Response, startTime: number): Promise<Response> {
  return addCorsHeaders(Response.json(getSystemStats(startTime)), req)
}

export async function handleGetUsageStats(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  // Get hours parameter from URL (default to 24 hours)
  const url = new URL(req.url)
  const hours = parseInt(url.searchParams.get("hours") || "24", 10)

  const summary = await getUsageStats(hours)

  const stats: UsageStats = {
    totalTokens: summary.totalTokens,
    totalInputTokens: summary.totalInputTokens,
    totalOutputTokens: summary.totalOutputTokens,
    totalCostUsd: summary.totalCostUsd,
    toonSavedTokens: summary.toonSavedTokens,
    toonSavedCost: summary.toonSavedCost,
    toonSavedBytes: summary.toonSavedBytes,
    toonSavedBytesPercent: summary.toonSavedBytesPercent,
    toonJsonTokens: summary.toonJsonTokens,
    toonToonTokens: summary.toonToonTokens,
    toonSavingsPercent: summary.toonSavingsPercent,
    byProvider: summary.byProvider,
    byModel: summary.byModel,
  }

  return addCorsHeaders(Response.json(stats), req)
}

// Add UsageStats interface for backend
interface UsageStats {
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  toonSavedTokens: number;
  toonSavedCost: number;
  toonSavedBytes: number;
  toonSavedBytesPercent: number;
  toonJsonTokens: number;
  toonToonTokens: number;
  toonSavingsPercent: number;
  byProvider: Record<string, { tokens: number; costUsd: number; inputTokens: number; outputTokens: number }>;
  byModel: Record<string, { tokens: number; costUsd: number; provider: string; inputTokens: number; outputTokens: number }>;
}

export async function handleSystemReload(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  return addCorsHeaders(Response.json({ success: true, message: "Reload triggered" }), req)
}

export async function handleApiReload(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  agent?: any
): Promise<Response> {
  try {
    const newConfig = await loadConfig()
    if (agent) {
      await agent.updateConfig(newConfig)
      await agent.reload()
    }
    return addCorsHeaders(Response.json({ success: true, message: "Configuration reloaded" }), req)
  } catch (error) {
    return addCorsHeaders(Response.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    ), req)
  }
}
