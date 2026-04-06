import type { Tool } from '../../types/tool'

export const conectarNodosTool: Tool = {
  name: 'conectar_nodos',
  description: 'Crea un edge entre dos nodos del canvas',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', description: 'ID del nodo origen' },
      target: { type: 'string', description: 'ID del nodo destino' },
      label: { type: 'string', description: 'Etiqueta del edge (opcional)' },
    },
    required: ['source', 'target'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
