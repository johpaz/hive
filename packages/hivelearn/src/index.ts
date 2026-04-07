/**
 * HiveLearn — Backend entry point
 * Exporta initHiveLearn() para ser llamado desde gateway/initializer.ts
 */
import { getDb } from '@johpaz/hive-agents-core/storage/sqlite'
import { logger } from './utils/logger'
import { upsertOllamaProvider, isOllamaAvailable } from './providers/ollama.provider'
import { registerHiveLearnAgents } from './agents/registry'
import { HIVELEARN_SCHEMA_V1, HIVELEARN_SCHEMA_V2 } from './storage/hivelearn-schema'

const log = logger.child('hivelearn:init')

let _initialized = false

export async function initHiveLearn(): Promise<void> {
  if (_initialized) return
  _initialized = true

  try {
    const db = getDb()

    // 1. Ejecutar migraciones SQLite (inline — funciona en binarios compilados)
    const migrations: Array<{ name: string; sql: string; optional?: boolean }> = [
      { name: '001_hivelearn', sql: HIVELEARN_SCHEMA_V1 },
      { name: '002_agent_outputs', sql: HIVELEARN_SCHEMA_V2, optional: true },
    ]

    for (const mig of migrations) {
      try {
        db.exec(mig.sql)
        log.info(`HiveLearn: migración ${mig.name} ejecutada`)
      } catch (e) {
        // ALTER TABLE ADD COLUMN IF NOT EXISTS puede fallar en SQLite < 3.37 — ignorar
        log.warn(`HiveLearn: migración ${mig.name} parcial: ${(e as Error).message}`)
      }
    }

    // 2. Upsert provider Ollama + modelo Gemma 4
    upsertOllamaProvider(db)
    log.info('HiveLearn: provider Ollama y modelo Gemma 4 E2B registrados')

    // 3. Registrar 14 agentes del enjambre
    registerHiveLearnAgents(db)
    log.info('HiveLearn: 14 agentes del enjambre registrados')

    // 4. Verificar disponibilidad de Ollama (no crítico)
    const ollamaOk = await isOllamaAvailable()
    if (ollamaOk) {
      log.info('HiveLearn ✅ listo — Ollama disponible con Gemma 4 E2B')
    } else {
      log.warn('HiveLearn ⚠️  Ollama no disponible en la URL configurada — módulo deshabilitado')
      log.warn(`  Configura HIVELEARN_OLLAMA_URL y asegúrate de tener: ollama pull ${process.env.HIVELEARN_MODEL ?? 'gemma4:2b'}`)
    }
  } catch (err) {
    log.error(`HiveLearn: error durante inicialización — ${(err as Error).message}`)
    throw err
  }
}

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
