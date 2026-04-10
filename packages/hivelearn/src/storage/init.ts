/**
 * initHiveLearnStorage — aplica el schema SQL de HiveLearn y registra los agentes.
 * Debe llamarse desde core (server.ts) justo después de initializeDatabase().
 */
import type { Database } from 'bun:sqlite'
import { HIVELEARN_SCHEMA_V1, HIVELEARN_SCHEMA_V2 } from './hivelearn-schema'
import { registerHiveLearnAgents } from '../agents/registry'

export function initHiveLearnStorage(db: Database): void {
  try {
    (db as any).exec(HIVELEARN_SCHEMA_V1)
  } catch (e) {
    // Si ya existe, ignorar
    const msg = (e as Error).message ?? ''
    if (!msg.includes('already exists')) throw e
  }

  try {
    (db as any).exec(HIVELEARN_SCHEMA_V2)
  } catch (e) {
    const msg = (e as Error).message ?? ''
    if (!msg.includes('already exists') && !msg.includes('duplicate column')) throw e
  }

  registerHiveLearnAgents(db)
}
