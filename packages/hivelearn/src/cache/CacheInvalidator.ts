import { getDb } from '@johpaz/hive-agents-core/storage/sqlite'

export class CacheInvalidator {
  /** Elimina entradas expiradas de hl_node_cache */
  invalidateExpired(): number {
    try {
      const db = getDb()
      const result = db.run(`DELETE FROM hl_node_cache WHERE expires_at < datetime('now')`)
      return result.changes
    } catch {
      return 0
    }
  }

  /** Invalida todas las entradas de un agente específico */
  invalidateByAgent(agenteTipo: string): number {
    try {
      const db = getDb()
      const result = db.run(`DELETE FROM hl_node_cache WHERE agente_tipo = ?`, [agenteTipo])
      return result.changes
    } catch {
      return 0
    }
  }

  /** Invalida entradas con tasa de abandono alta (ciclo de mejora continua) */
  invalidateIneffective(umbralTasaAbandono = 0.4): number {
    try {
      const db = getDb()
      const ineficaces = db.query(
        `SELECT DISTINCT agente_tipo, concepto_slug FROM hl_node_effectiveness WHERE tasa_abandono > ?`
      ).all(umbralTasaAbandono) as any[]

      let deleted = 0
      for (const row of ineficaces) {
        const result = db.run(
          `DELETE FROM hl_node_cache WHERE agente_tipo = ? AND concepto_slug = ?`,
          [row.agente_tipo, row.concepto_slug]
        )
        deleted += result.changes
      }
      return deleted
    } catch {
      return 0
    }
  }
}

export const cacheInvalidator = new CacheInvalidator()
