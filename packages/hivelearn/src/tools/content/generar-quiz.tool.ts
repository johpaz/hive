import type { Tool } from '../../types/tool'

export const generarQuizTool: Tool = {
  name: 'generar_quiz',
  description: 'Guarda una pregunta de quiz con 4 opciones',
  parameters: {
    type: 'object',
    properties: {
      pregunta: { type: 'string' },
      opciones: { type: 'array', items: { type: 'string' }, description: '4 opciones de respuesta' },
      indice_correcto: { type: 'number', description: 'Índice 0-3 de la opción correcta' },
      explicaciones_incorrectas: { type: 'array', items: { type: 'string' }, description: 'Explicación de por qué las 3 opciones incorrectas son incorrectas' },
    },
    required: ['pregunta', 'opciones', 'indice_correcto', 'explicaciones_incorrectas'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
