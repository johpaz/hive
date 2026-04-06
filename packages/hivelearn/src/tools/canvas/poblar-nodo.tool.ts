import type { Tool } from '../../types/tool'

export const poblarNodoTool: Tool = {
  name: 'poblar_nodo',
  description: 'Rellena un nodo del canvas con el contenido generado',
  parameters: {
    type: 'object',
    properties: {
      nodo_id: { type: 'string', description: 'ID del nodo a poblar' },
      contenido_json: { type: 'string', description: 'JSON string con el contenido del nodo' },
    },
    required: ['nodo_id', 'contenido_json'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
