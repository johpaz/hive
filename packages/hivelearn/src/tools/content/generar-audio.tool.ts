import type { Tool } from '../../types/tool'

export const generarAudioTool: Tool = {
  name: 'generar_audio',
  description: 'Genera un script de narración educativa para el concepto indicado. El texto será leído en voz alta por el browser usando Web Speech API.',
  parameters: {
    type: 'object',
    properties: {
      narration_text: {
        type: 'string',
        description: 'Texto completo de narración (máx 120 palabras). Claro, motivador y pausado. Sin markdown.',
      },
      voice_tone: {
        type: 'string',
        enum: ['friendly', 'professional', 'motivating'],
        description: 'Tono de voz para la narración',
      },
      key_pauses: {
        type: 'array',
        items: { type: 'string' },
        description: 'Fragmentos del texto donde hacer una pausa larga (para énfasis pedagógico)',
      },
      speed: {
        type: 'string',
        enum: ['slow', 'normal', 'fast'],
        description: 'Velocidad de lectura',
      },
      title: {
        type: 'string',
        description: 'Título corto de esta narración (para mostrar en UI)',
      },
    },
    required: ['narration_text', 'voice_tone', 'key_pauses', 'speed', 'title'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
