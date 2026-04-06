import type { Tool } from '../../types/tool'

export const generarEvaluacionTool: Tool = {
  name: 'generar_evaluacion',
  description: 'Genera 5 preguntas de evaluación final (3 opción múltiple + 2 respuesta corta)',
  parameters: {
    type: 'object',
    properties: {
      preguntas: {
        type: 'array',
        description: '5 preguntas de evaluación',
        items: {
          type: 'object',
          properties: {
            tipo: { type: 'string', enum: ['multiple_choice', 'respuesta_corta'] },
            pregunta: { type: 'string' },
            opciones: { type: 'array', items: { type: 'string' }, description: 'Solo para multiple_choice: 4 opciones' },
            indice_correcto: { type: 'number', description: 'Solo para multiple_choice: índice 0-3' },
            respuesta_esperada: { type: 'string', description: 'Solo para respuesta_corta' },
          },
          required: ['tipo', 'pregunta'],
        },
      },
    },
    required: ['preguntas'],
  },
  execute: async (params) => {
    const preguntas = params.preguntas as any[]
    if (preguntas.length !== 5) {
      return { ok: false, error: 'Se requieren exactamente 5 preguntas' }
    }
    return { ok: true, output: { preguntas } }
  },
}
