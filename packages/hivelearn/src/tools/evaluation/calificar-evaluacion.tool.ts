import type { Tool } from '../../types/tool'

export const calificarEvaluacionTool: Tool = {
  name: 'calificar_evaluacion',
  description: 'Califica las respuestas del alumno y genera feedback de cierre',
  parameters: {
    type: 'object',
    properties: {
      puntaje: { type: 'number', description: 'Puntaje 0-100' },
      preguntas_correctas: { type: 'number' },
      total_preguntas: { type: 'number' },
      mensaje_cierre: { type: 'string', description: 'Mensaje motivacional de cierre en español' },
      logros_desbloqueados: { type: 'array', items: { type: 'string' }, description: 'IDs de logros desbloqueados' },
      xp_ganado: { type: 'number' },
      razonamiento: { type: 'string', description: 'Resumen de puntos fuertes y débiles detectados' },
    },
    required: ['puntaje', 'preguntas_correctas', 'total_preguntas', 'mensaje_cierre', 'xp_ganado'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}

export const calificarRespuestaTool: Tool = {
  name: 'calificar_respuesta',
  description: 'Evalúa si el alumno comprende el concepto. Juzga comprensión semántica, no exactitud literal.',
  parameters: {
    type: 'object',
    properties: {
      correcto: { type: 'boolean', description: '¿El alumno captó la idea principal?' },
      xp_ganado: { type: 'number', description: 'XP ganado: 20 si correcto, 5 si parcial, 0 si incorrecto' },
      mensaje: { type: 'string', description: 'Feedback motivador en español (1-2 frases)' },
      razonamiento: { type: 'string', description: 'Por qué se considera correcto o incorrecto' },
      pista_si_incorrecto: { type: 'string', description: 'Pista para guiar al alumno si falló' },
    },
    required: ['correcto', 'xp_ganado', 'mensaje', 'razonamiento'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
