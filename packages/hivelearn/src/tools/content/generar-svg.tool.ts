import type { Tool } from '../../types/tool'

export const generarSvgTool: Tool = {
  name: 'generar_svg',
  description: 'Guarda un diagrama SVG educativo (viewBox 400x300, sin scripts)',
  parameters: {
    type: 'object',
    properties: {
      svg_string: {
        type: 'string',
        description: 'SVG completo: viewBox="0 0 400 300", paleta HiveLearn (#F59E0B amber, #1F2937 dark), máx 40 elementos, sin scripts ni event handlers',
      },
    },
    required: ['svg_string'],
  },
  execute: async (params) => {
    const svg = (params.svg_string as string).trim()
    if (!svg.startsWith('<svg') && !svg.startsWith('<?xml')) {
      return { ok: false, error: 'svg_string debe comenzar con <svg' }
    }
    return { ok: true, output: { svgString: svg } }
  },
}
