import type { Tool } from '../../types/tool'

export const marcarCompletadoTool: Tool = {
  name: 'marcar_completado',
  description: 'Marca un nodo del canvas como completado',
  parameters: {
    type: 'object',
    properties: {
      nodo_id: { type: 'string' },
      xp_ganado: { type: 'number' },
    },
    required: ['nodo_id'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
