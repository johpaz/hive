import type { Tool } from '../../types/tool'

export const avanzarNodoTool: Tool = {
  name: 'avanzar_nodo',
  description: 'Avanza al siguiente nodo disponible del currículo',
  parameters: {
    type: 'object',
    properties: {
      nodo_actual_id: { type: 'string' },
      siguiente_nodo_id: { type: 'string' },
    },
    required: ['nodo_actual_id', 'siguiente_nodo_id'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
