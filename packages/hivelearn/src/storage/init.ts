/**
 * initHiveLearnStorage — aplica el schema SQL de HiveLearn y registra los agentes.
 * Debe llamarse desde core (server.ts) justo después de initializeDatabase().
 * Es idempotente: todos los DDL usan IF NOT EXISTS.
 */
import type { Database } from 'bun:sqlite'
import { HIVELEARN_SCHEMA_V1, HIVELEARN_SCHEMA_V2 } from './hivelearn-schema'
import { registerHiveLearnAgents } from '../agents/registry'

/** Añade una columna a una tabla solo si no existe (compatible con cualquier versión de SQLite) */
function ensureColumn(db: Database, table: string, column: string, definition: string): void {
  const cols = (db as any).query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!cols.some(c => c.name === column)) {
    (db as any).exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

export function initHiveLearnStorage(db: Database): void {
  (db as any).exec(HIVELEARN_SCHEMA_V1)

  // V2: CREATE TABLE y CREATE INDEX (sin ALTER TABLE)
  try {
    (db as any).exec(HIVELEARN_SCHEMA_V2)
  } catch (e) {
    const msg = (e as Error).message ?? ''
    if (!msg.includes('duplicate column') && !msg.includes('already exists')) throw e
  }

  // V2 ALTER TABLE: añadir columnas idempotente sin IF NOT EXISTS (no soportado en SQLite < 3.37)
  ensureColumn(db, 'hl_sessions', 'rating', 'INTEGER DEFAULT NULL')
  ensureColumn(db, 'hl_sessions', 'rating_comentario', 'TEXT DEFAULT NULL')

  registerHiveLearnAgents(db)
}
