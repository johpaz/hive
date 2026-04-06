import type { Tool } from '../../types/tool'

export const clasificarIntencionTool: Tool = {
  name: 'clasificar_intencion',
  description: 'Extrae tema, nivel y tono desde la meta de aprendizaje del alumno',
  parameters: {
    type: 'object',
    properties: {
      tema: { type: 'string', description: 'Tema extraído de la meta' },
      nivel_detectado: { type: 'string', enum: ['principiante','principiante_base','intermedio'], description: 'Nivel inferido' },
      topic_slug: { type: 'string', description: 'Slug del tema en hl_topics si se encontró coincidencia, o null' },
      tono: { type: 'string', description: 'Tono recomendado: amigable|motivador|técnico|neutro' },
      confianza: { type: 'number', description: 'Confianza de clasificación 0-1' },
    },
    required: ['tema', 'nivel_detectado', 'tono', 'confianza'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
