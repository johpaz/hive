/**
 * HiveLearn — Backend entry point
 * Exporta initHiveLearn() para ser llamado desde gateway/initializer.ts
 */
import { logger } from './utils/logger'

const log = logger.child('hivelearn:init')


// Re-exportar tipos y utilidades para uso externo
export type { StudentProfile, LessonProgram, SwarmProgress, NodoLesson } from './types'
export { HiveLearnSwarm } from './swarm/HiveLearnSwarm'
export { nodeCache } from './cache/NodeCache'
export { cacheInvalidator } from './cache/CacheInvalidator'
export { AGENT_IDS } from './agents/registry'
export { updateHiveLearnAgentsProviderModel } from './agents/registry'
export { LessonPersistence } from './persistence/LessonPersistence'
export { hlSwarmEmitter } from './events/swarm-events'
export { runHiveLearnAgent } from './agent/runner'
export { AGENT_PROMPTS } from './agent/prompts'
export { calificarRespuestaTool } from './tools/evaluation/calificar-evaluacion.tool'
