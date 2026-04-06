import type { Tool } from '../../types/tool'

/**
 * Tool del Coordinador para registrar su revisión pedagógica del LessonProgram.
 * Es una structured-output tool — los args son el resultado final.
 */
export const revisarProgramaTool: Tool = {
  name: 'revisar_programa',
  description: 'Registra la revisión pedagógica del LessonProgram generado por el enjambre',
  parameters: {
    type: 'object',
    properties: {
      aprobado: {
        type: 'boolean',
        description: 'Si el programa pasa la revisión de calidad pedagógica',
      },
      calidad: {
        type: 'number',
        description: 'Puntuación de calidad 0-100',
      },
      issues: {
        type: 'array',
        items: { type: 'string' },
        description: 'Lista de problemas detectados (vacía si todo está bien)',
      },
      correcciones: {
        type: 'object',
        description: 'Correcciones opcionales por nodeId. Ejemplo: {"nodo-1": {"titulo": "...", "xpRecompensa": 30}}',
        additionalProperties: true,
      },
      mensaje: {
        type: 'string',
        description: 'Resumen de la revisión para el log',
      },
    },
    required: ['aprobado', 'calidad', 'mensaje'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
