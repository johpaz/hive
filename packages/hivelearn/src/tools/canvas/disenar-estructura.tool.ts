import type { Tool } from '../../types/tool'

/** El StructureAgent llama esta tool con el diseño del programa completo */
export const disenarEstructuraTool: Tool = {
  name: 'disenar_estructura',
  description: 'Guarda el diseño del currículo de HiveLearn: array de nodos con tipo pedagógico y visual',
  parameters: {
    type: 'object',
    properties: {
      tema: { type: 'string', description: 'Tema principal del programa' },
      nivel: { type: 'string', description: 'Nivel del alumno: principiante|principiante_base|intermedio' },
      nodos: {
        type: 'array',
        description: 'Array de nodos del programa',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            titulo: { type: 'string' },
            concepto: { type: 'string' },
            tipo_pedagogico: { type: 'string', enum: ['concept','exercise','quiz','challenge','milestone','evaluation'] },
            tipo_visual: { type: 'string', enum: ['text_card','code_block','svg_diagram','gif_guide','infographic','chart','animated_card'] },
            xp_recompensa: { type: 'number' },
          },
          required: ['id','titulo','concepto','tipo_pedagogico','tipo_visual'],
        },
      },
    },
    required: ['tema', 'nivel', 'nodos'],
  },
  execute: async (params) => ({ ok: true, output: params }),
}
