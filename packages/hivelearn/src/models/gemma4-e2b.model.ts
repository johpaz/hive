/** Configuración base del modelo Gemma 4 E2B para todos los agentes de HiveLearn */

export const GEMMA4_BASE = {
  model: process.env.HIVELEARN_MODEL,
  max_tokens: 800,
  temperature: 0.7,
  num_ctx: 2048,
} as const

/** Configuración para agentes de código y SVG (outputs deterministas) */
export const GEMMA4_CODE = {
  ...GEMMA4_BASE,
  temperature: 0.3,
} as const

/** Configuración para agentes de evaluación (mezcla precisión + creatividad) */
export const GEMMA4_EVAL = {
  ...GEMMA4_BASE,
  temperature: 0.5,
  max_tokens: 1200,
} as const

/** Semilla de temperatura por tipo de agente */
export const AGENT_TEMPERATURE: Record<string, number> = {
  profile: 0.3,
  intent: 0.3,
  structure: 0.5,
  explanation: 0.7,
  exercise: 0.7,
  quiz: 0.7,
  challenge: 0.7,
  code: 0.3,
  svg: 0.3,
  gif: 0.7,
  infographic: 0.7,
  gamification: 0.7,
  evaluation: 0.5,
  feedback: 0.7,
  postsession: 0.1,
}
