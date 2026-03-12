import { getDb } from "../../storage/sqlite.ts"
import { loadConfig } from "../../config/loader.ts"
import { cpus } from "node:os"

export function getSystemStats(startTime: number) {
  const mem = process.memoryUsage()
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000)
  const uptimeStr = new Date(uptimeSeconds * 1000).toISOString().substr(11, 8)
  
  return {
    cpu: 0, // Placeholder - Node.js doesn't provide per-process CPU
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024), // MB
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024), // MB
      heapPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100 * 100) / 100,
      external: Math.round((mem.external || 0) / 1024 / 1024), // MB
    },
    uptime: uptimeStr,
    connections: 0, // Placeholder
    cores: cpus().length,
    recentMessages: 0, // Placeholder
  }
}

export async function handleGetActivityStats(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const db = getDb()
  const url = new URL(req.url)
  const hours = parseInt(url.searchParams.get("hours") || "12", 10)
  
  // Get message counts per hour from conversations table
  const now = Date.now()
  const startTime = now - (hours * 60 * 60 * 1000)
  
  const rows = db.query(`
    SELECT 
      strftime('%Y-%m-%d %H:00', datetime(created_at, 'unixepoch')) as hour,
      COUNT(*) as count
    FROM conversations
    WHERE created_at >= ?
    GROUP BY hour
    ORDER BY hour
  `).all(startTime / 1000) as { hour: string; count: number }[]
  
  // Format as array expected by frontend
  const activityData = rows.map(r => ({
    time: r.hour,
    count: r.count,
  }))
  
  return addCorsHeaders(Response.json(activityData), req)
}

export async function handleGetSystemStats(req: Request, addCorsHeaders: (r: Response, req: Request) => Response, startTime: number): Promise<Response> {
  return addCorsHeaders(Response.json(getSystemStats(startTime)), req)
}

export async function handleGetUsageStats(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const db = getDb()

  // Get hours parameter from URL (default to 24 hours)
  const url = new URL(req.url)
  const hours = parseInt(url.searchParams.get("hours") || "24", 10)
  const since = Math.floor(Date.now() / 1000) - (hours * 3600)

  // Get totals from usage_records table
  const totals = db.query(`
    SELECT
      COALESCE(SUM(input_tokens), 0) as inputTokens,
      COALESCE(SUM(output_tokens), 0) as outputTokens,
      COALESCE(SUM(cost_usd), 0) as costUsd
    FROM usage_records
    WHERE created_at >= ?
  `).get(since) as { inputTokens: number; outputTokens: number; costUsd: number }

  // Get by provider
  const byProviderRows = db.query(`
    SELECT
      provider,
      COALESCE(SUM(input_tokens), 0) as inputTokens,
      COALESCE(SUM(output_tokens), 0) as outputTokens,
      COALESCE(SUM(cost_usd), 0) as costUsd
    FROM usage_records
    WHERE created_at >= ?
    GROUP BY provider
  `).all(since) as { provider: string; inputTokens: number; outputTokens: number; costUsd: number }[]

  // Get by model
  const byModelRows = db.query(`
    SELECT
      model,
      COALESCE(SUM(input_tokens), 0) as inputTokens,
      COALESCE(SUM(output_tokens), 0) as outputTokens,
      COALESCE(SUM(cost_usd), 0) as costUsd
    FROM usage_records
    WHERE created_at >= ?
    GROUP BY model
  `).all(since) as { model: string; inputTokens: number; outputTokens: number; costUsd: number }[]

  const totalTokens = (totals.inputTokens || 0) + (totals.outputTokens || 0)
  const totalCostUsd = totals.costUsd || 0

  // TOON savings - get from usage_records table
  const toonTotals = db.query(`
    SELECT
      COALESCE(SUM(toon_saved_tokens), 0) as toonSavedTokens,
      COALESCE(SUM(toon_saved_cost), 0) as toonSavedCost
    FROM usage_records
    WHERE created_at >= ?
  `).get(since) as { toonSavedTokens: number; toonSavedCost: number }

  const toonSavedTokens = toonTotals?.toonSavedTokens || 0
  const toonSavedCost = toonTotals?.toonSavedCost || 0
  const toonSavingsPercent = totalTokens > 0
    ? (toonSavedTokens / (totalTokens + toonSavedTokens)) * 100
    : 0

  const stats: UsageStats = {
    totalTokens,
    totalInputTokens: totals.inputTokens || 0,
    totalOutputTokens: totals.outputTokens || 0,
    totalCostUsd,
    toonSavedTokens,
    toonSavedCost,
    toonSavingsPercent,
    byProvider: Object.fromEntries(
      byProviderRows.map(r => [r.provider, {
        tokens: (r.inputTokens || 0) + (r.outputTokens || 0),
        costUsd: r.costUsd || 0,
        inputTokens: r.inputTokens || 0,
        outputTokens: r.outputTokens || 0,
      }])
    ),
    byModel: Object.fromEntries(
      byModelRows.map(r => [r.model, {
        tokens: (r.inputTokens || 0) + (r.outputTokens || 0),
        costUsd: r.costUsd || 0,
        provider: "unknown",
        inputTokens: r.inputTokens || 0,
        outputTokens: r.outputTokens || 0,
      }])
    ),
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
