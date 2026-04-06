import type { Tool } from '../../types/tool'
import { getDb } from '@johpaz/hive-agents-core/storage/sqlite'

export const buscarCurriculoExistenteTool: Tool = {
  name: 'buscar_curriculo_existente',
  description: 'Busca un currículo cacheado en SQLite por topic_slug y rango_edad',
  parameters: {
    type: 'object',
    properties: {
      topic_slug: { type: 'string' },
      rango_edad: { type: 'string', enum: ['nino','adolescente','adulto'] },
    },
    required: ['topic_slug', 'rango_edad'],
  },
  execute: async (params) => {
    try {
      const db = getDb()
      const curriculo = db.query(
        `SELECT * FROM hl_curricula WHERE topic_slug = ? AND rango_edad = ? ORDER BY created_at DESC LIMIT 1`
      ).get(params.topic_slug as string, params.rango_edad as string) as any
      if (!curriculo) return { ok: true, encontrado: false }
      return { ok: true, encontrado: true, curriculo }
    } catch {
      return { ok: true, encontrado: false }
    }
  },
}
