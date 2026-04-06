import type { Tool } from '../../types/tool'

export const generarEjercicioTool: Tool = {
  name: 'generar_ejercicio',
  description: 'Guarda un ejercicio práctico generado',
  parameters: {
    type: 'object',
    properties: {
      enunciado: { type: 'string' },
      ejemplo_respuesta: { type: 'string' },
      respuesta_correcta: { type: 'string' },
      pista_opcional: { type: 'string' },
    },
    required: ['enunciado', 'ejemplo_respuesta', 'respuesta_correcta'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
