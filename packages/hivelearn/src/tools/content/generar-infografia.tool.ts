import type { Tool } from '../../types/tool'

export const generarInfografiaTool: Tool = {
  name: 'generar_infografia',
  description: 'Guarda una infografía con 3-5 secciones de datos clave',
  parameters: {
    type: 'object',
    properties: {
      secciones: {
        type: 'array',
        description: '3 a 5 secciones',
        items: {
          type: 'object',
          properties: {
            emoji: { type: 'string' },
            titulo: { type: 'string' },
            valor: { type: 'string', description: 'Dato, número o hecho clave' },
          },
          required: ['emoji', 'titulo', 'valor'],
        },
      },
    },
    required: ['secciones'],
  },
  execute: async (params) => {
    const secciones = params.secciones as any[]
    if (secciones.length < 3 || secciones.length > 5) {
      return { ok: false, error: 'Se requieren entre 3 y 5 secciones' }
    }
    return { ok: true, output: { secciones } }
  },
}
