import type { Tool } from '../../types/tool'

export const generarRetoTool: Tool = {
  name: 'generar_reto',
  description: 'Guarda un reto práctico con pasos y criterios de éxito',
  parameters: {
    type: 'object',
    properties: {
      titulo: { type: 'string' },
      contexto: { type: 'string' },
      pasos: { type: 'array', items: { type: 'string' }, description: '4 pasos del reto' },
      criterios_exito: { type: 'array', items: { type: 'string' } },
    },
    required: ['titulo', 'contexto', 'pasos', 'criterios_exito'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
