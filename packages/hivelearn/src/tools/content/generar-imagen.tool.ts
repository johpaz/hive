import type { Tool } from '../../types/tool'

export const generarImagenTool: Tool = {
  name: 'generar_imagen',
  description: 'Genera o describe una imagen educativa para el nodo. Si el modelo soporta visión, genera la imagen; si no, crea un SVG representativo como fallback.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Descripción visual detallada de la imagen a generar' },
      concepto: { type: 'string', description: 'Concepto pedagógico que ilustra la imagen' },
      estilo: { type: 'string', enum: ['diagram', 'illustration', 'chart'], description: 'Estilo visual de la imagen' },
      alt_text: { type: 'string', description: 'Texto alternativo accesible para la imagen' },
      caption: { type: 'string', description: 'Pie de imagen educativo (1-2 frases)' },
      svg_fallback: { type: 'string', description: 'SVG inline como fallback si no se puede generar imagen (400x300, educativo y claro)' },
    },
    required: ['prompt', 'concepto', 'estilo', 'alt_text', 'caption', 'svg_fallback'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
