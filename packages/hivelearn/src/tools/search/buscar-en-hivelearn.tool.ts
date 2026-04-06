import type { Tool } from '../../types/tool'
import { getDb } from '@johpaz/hive-agents-core/storage/sqlite'

export const buscarEnHiveLearnTool: Tool = {
  name: 'buscar_en_hivelearn',
  description: 'Búsqueda full-text en el índice FTS5 de HiveLearn',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Términos de búsqueda' },
      tipo: { type: 'string', description: 'Filtrar por tipo: topic|curriculo|nodo (opcional)' },
      limite: { type: 'number', description: 'Máx resultados (default: 5)' },
    },
    required: ['query'],
  },
  execute: async (params) => {
    try {
      const db = getDb()
      const limite = (params.limite as number) ?? 5
      let sql = `SELECT entidad_tipo, entidad_id, snippet(hl_search_fts, 0, '<b>', '</b>', '...', 10) as snippet
                 FROM hl_search_fts WHERE contenido_texto MATCH ?`
      const args: any[] = [params.query]
      if (params.tipo) {
        sql += ` AND entidad_tipo = ?`
        args.push(params.tipo)
      }
      sql += ` LIMIT ?`
      args.push(limite)
      const results = db.query(sql).all(...args) as any[]
      return { ok: true, resultados: results, total: results.length }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
}
