import type { Tool } from '../../types/tool'

export const generarFramesGifTool: Tool = {
  name: 'generar_frames_gif',
  description: 'Guarda frames animados que simulan un GIF educativo (5-8 frames)',
  parameters: {
    type: 'object',
    properties: {
      frames: {
        type: 'array',
        description: '5 a 8 frames de animación',
        items: {
          type: 'object',
          properties: {
            emoji: { type: 'string', description: 'Emoji grande representativo' },
            texto: { type: 'string', description: 'Texto explicativo en máx 8 palabras' },
            duracion_ms: { type: 'number', description: 'Duración del frame en ms (default: 1500)' },
          },
          required: ['emoji', 'texto'],
        },
      },
    },
    required: ['frames'],
  },
  execute: async (params) => {
    const frames = params.frames as any[]
    if (frames.length < 5 || frames.length > 8) {
      return { ok: false, error: 'Se requieren entre 5 y 8 frames' }
    }
    return { ok: true, output: { frames: frames.map(f => ({ ...f, duracionMs: f.duracion_ms ?? 1500 })) } }
  },
}
