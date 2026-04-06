import type { Tool } from '../../types/tool'

export const generarExplicacionTool: Tool = {
  name: 'generar_explicacion',
  description: 'Guarda una explicación de concepto generada para un nodo',
  parameters: {
    type: 'object',
    properties: {
      titulo: { type: 'string', description: 'Título del concepto' },
      explicacion: { type: 'string', description: 'Explicación en máx 70 palabras' },
      ejemplo_concreto: { type: 'string', description: 'Ejemplo concreto del concepto' },
    },
    required: ['titulo', 'explicacion', 'ejemplo_concreto'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
