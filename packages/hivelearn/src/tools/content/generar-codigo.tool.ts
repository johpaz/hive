import type { Tool } from '../../types/tool'

export const generarCodigoTool: Tool = {
  name: 'generar_codigo',
  description: 'Guarda un bloque de código con sintaxis resaltada (máx 15 líneas)',
  parameters: {
    type: 'object',
    properties: {
      lenguaje: { type: 'string', enum: ['javascript','typescript','python','html','css','sql','bash'] },
      codigo: { type: 'string', description: 'Código en máx 15 líneas' },
      descripcion_breve: { type: 'string', description: 'Qué hace el código en una oración' },
    },
    required: ['lenguaje', 'codigo', 'descripcion_breve'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
