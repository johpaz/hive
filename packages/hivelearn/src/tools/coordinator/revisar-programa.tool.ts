import type { Tool } from '../../types/tool'

/**
 * Tool del Coordinador para registrar su revisión pedagógica del LessonProgram.
 * Es una structured-output tool — los args son el resultado final.
 * Incluye redistribución de XP, validación pedagógica avanzada y logging detallado.
 */
export const revisarProgramaTool: Tool = {
  name: 'revisar_programa',
  description: 'Registra la revisión pedagógica del LessonProgram generado por el enjambre. Incluye redistribución de XP, validación avanzada y logging detallado.',
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
      suggestedRetries: {
        type: 'array',
        items: { type: 'string' },
        description: 'Lista de task IDs que deben re-ejecutarse porque el contenido está vacío, es incoherente o falló. Usa los IDs exactos: "content-nodo-0", "visual-nodo-2", etc. Máximo 3 retries.',
      },
      xpRedistribuido: {
        type: 'object',
        description: 'Mapa de nodeId -> XP redistribuido para totalizar exactamente 100 puntos. Ejemplo: {"nodo-0": 5, "nodo-1": 15, "nodo-2": 20}',
        additionalProperties: true,
      },
      validacionPedagogica: {
        type: 'object',
        description: 'Métricas avanzadas de validación pedagógica por nodo',
        properties: {
          claridad: { type: 'number', description: 'Puntuación claridad 0-100' },
          adecuacionEdad: { type: 'number', description: 'Puntuación adecuación a edad 0-100' },
          ejemplosConcretos: { type: 'number', description: 'Puntuación ejemplos concretos 0-100' },
          progresionLogica: { type: 'number', description: 'Puntuación progresión lógica 0-100' },
          engagement: { type: 'number', description: 'Puntuación engagement 0-100' },
          coberturaTemática: { type: 'number', description: 'Puntuación cobertura temática 0-100' },
          detalles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                nodoId: { type: 'string' },
                criterios: {
                  type: 'object',
                  properties: {
                    claridad: { type: 'boolean' },
                    adecuacionEdad: { type: 'boolean' },
                    ejemplosConcretos: { type: 'boolean' },
                    progresionLogica: { type: 'boolean' },
                    engagement: { type: 'boolean' },
                    coberturaTemática: { type: 'boolean' },
                  }
                },
                observaciones: { type: 'string' }
              }
            }
          }
        }
      },
      loggingDetallado: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            timestamp: { type: 'string', description: 'ISO timestamp' },
            agente: { type: 'string', description: 'ID del agente' },
            accion: { type: 'string', description: 'Acción realizada' },
            resultado: { type: 'string', description: 'Resultado de la acción' },
            metricas: { type: 'object', description: 'Métricas relevantes' }
          }
        },
        description: 'Logging detallado de decisiones y validaciones'
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
