import type { Tool } from '../../types/tool'

export const crearNodoCanvasTool: Tool = {
  name: 'crear_nodo_canvas',
  description: 'Crea un nuevo nodo en el canvas de la lección',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      titulo: { type: 'string' },
      tipo_pedagogico: { type: 'string' },
      tipo_visual: { type: 'string' },
      pos_x: { type: 'number' },
      pos_y: { type: 'number' },
      xp_recompensa: { type: 'number' },
    },
    required: ['id', 'titulo', 'tipo_pedagogico', 'tipo_visual'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
