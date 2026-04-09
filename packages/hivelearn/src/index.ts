/**
 * HiveLearn — Backend entry point
 */

// ─── Tipos públicos ───────────────────────────────────────────────────────────
export type {
  StudentProfile,
  LessonProgram,
  SwarmProgress,
  NodoLesson,
  NodoContenido,
  MicroEvaluacion,
  FeedbackOutput,
  EvaluacionOutput,
  PreguntaEvaluacion,
  GamificacionOutput,
  Logro,
  RangoEdad,
  TipoPedagogico,
  TipoVisual,
  EstadoNodo,
} from './types'

export type { CalificacionOutput, CalificacionInput } from './tools/evaluation/calificar-evaluacion.tool'
export type { SessionData, SessionMetrics } from './persistence/LessonPersistence'

// ─── Swarm y sesión ───────────────────────────────────────────────────────────
export { HiveLearnSwarm } from './swarm/HiveLearnSwarm'
export { runHiveLearnSession } from './swarm/session'

// ─── Persistencia ─────────────────────────────────────────────────────────────
export { LessonPersistence } from './persistence/LessonPersistence'

// ─── Evaluación ───────────────────────────────────────────────────────────────
export { evaluarRespuestas } from './tools/evaluation/calificar-evaluacion.tool'
export { calificarEvaluacionTool, calificarRespuestaTool } from './tools/evaluation/calificar-evaluacion.tool'

// ─── Agentes y configuración ──────────────────────────────────────────────────
export { AGENT_IDS, updateHiveLearnAgentsProviderModel } from './agents/registry'
export { AGENT_PROMPTS } from './agent/prompts'
export { runHiveLearnAgent } from './agent/runner'

// ─── Eventos SSE ──────────────────────────────────────────────────────────────
export { hlSwarmEmitter } from './events/swarm-events'

// ─── Cache ────────────────────────────────────────────────────────────────────
export { nodeCache } from './cache/NodeCache'
export { cacheInvalidator } from './cache/CacheInvalidator'
