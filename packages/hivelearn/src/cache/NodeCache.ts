import { getDb } from '@johpaz/hive-agents-core/storage/sqlite'

const TTL_DAYS = Number(process.env.HIVELEARN_CACHE_TTL_DAYS ?? 30)

function buildKey(agenteTipo: string, conceptoSlug: string, nivel: string, rangoEdad: string): string {
  return `${agenteTipo}:${conceptoSlug}:${nivel}:${rangoEdad}`
}

function expiresAt(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

export interface CachedOutput {
  cacheKey: string
  agenteTipo: string
  conceptoSlug: string
  nivel: string
  rangoEdad: string
  outputJson: string
  hits: number
}

export class NodeCache {
  get(agenteTipo: string, conceptoSlug: string, nivel: string, rangoEdad: string): CachedOutput | null {
    try {
      const db = getDb()
      const key = buildKey(agenteTipo, conceptoSlug, nivel, rangoEdad)
      const row = db.query(
        `SELECT * FROM hl_node_cache WHERE cache_key = ? AND expires_at > datetime('now')`
      ).get(key) as any
      return row ? {
        cacheKey: row.cache_key,
        agenteTipo: row.agente_tipo,
        conceptoSlug: row.concepto_slug,
        nivel: row.nivel,
        rangoEdad: row.rango_edad,
        outputJson: row.output_json,
        hits: row.hits,
      } : null
    } catch {
      return null
    }
  }

  set(agenteTipo: string, conceptoSlug: string, nivel: string, rangoEdad: string, output: unknown): void {
    try {
      const db = getDb()
      const key = buildKey(agenteTipo, conceptoSlug, nivel, rangoEdad)
      db.run(
        `INSERT OR REPLACE INTO hl_node_cache (cache_key, agente_tipo, concepto_slug, nivel, rango_edad, output_json, hits, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
        [key, agenteTipo, conceptoSlug, nivel, rangoEdad, JSON.stringify(output), expiresAt(TTL_DAYS)]
      )
    } catch { /* cache miss no es crítico */ }
  }

  hit(agenteTipo: string, conceptoSlug: string, nivel: string, rangoEdad: string): void {
    try {
      const db = getDb()
      const key = buildKey(agenteTipo, conceptoSlug, nivel, rangoEdad)
      db.run(`UPDATE hl_node_cache SET hits = hits + 1 WHERE cache_key = ?`, [key])
    } catch { /* silencioso */ }
  }
}

export const nodeCache = new NodeCache()
