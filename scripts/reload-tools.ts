#!/usr/bin/env bun
/**
 * Script para limpiar y recargar las tools desde el seed
 * 
 * Uso:
 *   bun run scripts/reload-tools.ts
 * 
 * Este script:
 * 1. Elimina TODAS las tools de la tabla `tools`
 * 2. Elimina TODAS las entradas de la tabla FTS5 `tools_fts`
 * 3. Recarga las tools desde SEED_DATA en ambas tablas
 * 4. Muestra el resultado de la operación
 */

import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { SEED_DATA } from "../packages/core/src/storage/seed"

// Obtener ruta de la base de datos
const DEFAULT_DB_PATH = process.env.HIVE_HOME
  ? `${process.env.HIVE_HOME}/data/hive.db`
  : `${process.env.HOME}/.hive-dev/data/hive.db`

const dbPath = process.argv[2] || DEFAULT_DB_PATH

console.log(`📦 Usando base de datos: ${dbPath}`)

if (!existsSync(dbPath)) {
  console.error(`❌ No se encontró la base de datos en: ${dbPath}`)
  console.error(`   Pasa la ruta como argumento: bun run scripts/reload-tools.ts /ruta/a/hive.db`)
  process.exit(1)
}

// Conectar a la base de datos
const db = new Database(dbPath)
db.exec("PRAGMA foreign_keys = ON")

try {
  // 1. Eliminar todas las tools existentes de la tabla principal
  console.log("\n🗑️  Eliminando tools de la tabla `tools`...")
  const deleteStmt = db.prepare("DELETE FROM tools")
  const result = deleteStmt.run()
  console.log(`   ✅ ${result.changes} tools eliminadas`)

  // 2. Eliminar todas las entradas de la tabla FTS5
  console.log("\n🗑️  Eliminando entradas de `tools_fts`...")
  const deleteFtsStmt = db.prepare("DELETE FROM tools_fts")
  const resultFts = deleteFtsStmt.run()
  console.log(`   ✅ ${resultFts.changes} entradas FTS eliminadas`)

  // 3. Insertar tools desde el seed (tabla principal)
  console.log("\n📥 Insertando tools en `tools`...")
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO tools (id, name, description, category, enabled, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
  `)

  const insertMany = db.transaction((tools: Array<[string, string, string, string, number, number]>) => {
    for (const tool of tools) {
      insertStmt.run(...tool)
    }
  })

  // Preparar datos del seed
  const toolsData = SEED_DATA.tools.map((tool) => [
    tool.id,
    tool.name,
    tool.description,
    tool.category,
    tool.enabled !== false ? 1 : 0, // default a 1 si no está especificado
    !("active" in tool) || tool.active !== false ? 1 : 0, // default a 1 si no está especificado (igual que seed.ts)
  ] as [string, string, string, string, number, number])

  insertMany(toolsData)
  console.log(`   ✅ ${toolsData.length} tools insertadas`)

  // 4. Sincronizar con la tabla FTS5
  console.log("\n📥 Sincronizando tools en `tools_fts`...")
  const insertFtsStmt = db.prepare(`
    INSERT OR REPLACE INTO tools_fts(tool_name, name, description, category)
    VALUES (?, ?, ?, ?)
  `)

  const insertFtsMany = db.transaction((tools: Array<[string, string, string, string]>) => {
    for (const tool of tools) {
      insertFtsStmt.run(...tool)
    }
  })

  const toolsFtsData = SEED_DATA.tools.map((tool) => [
    tool.name,
    tool.name,
    tool.description,
    tool.category,
  ] as [string, string, string, string])

  insertFtsMany(toolsFtsData)
  console.log(`   ✅ ${toolsFtsData.length} entradas FTS insertadas`)

  // 5. Verificar resultado
  const countStmt = db.prepare("SELECT COUNT(*) as count FROM tools")
  const count: { count: number } = countStmt.get() as { count: number }
  console.log(`\n📊 Total de tools en ` + "`tools`" + `: ${count.count}`)

  const countFtsStmt = db.prepare("SELECT COUNT(*) as count FROM tools_fts")
  const countFts: { count: number } = countFtsStmt.get() as { count: number }
  console.log(`📊 Total de entradas en ` + "`tools_fts`" + `: ${countFts.count}`)

  // 6. Mostrar tools por categoría
  const byCategoryStmt = db.prepare(`
    SELECT category, COUNT(*) as count 
    FROM tools 
    GROUP BY category 
    ORDER BY category
  `)
  const categories: Array<{ category: string; count: number }> = byCategoryStmt.all() as Array<{ category: string; count: number }>

  console.log("\n📁 Tools por categoría:")
  for (const cat of categories) {
    console.log(`   • ${cat.category}: ${cat.count}`)
  }

  console.log("\n✅ ¡Tools recargadas exitosamente en ambas tablas!")

} catch (error) {
  console.error("\n❌ Error:", error instanceof Error ? error.message : error)
  process.exit(1)
} finally {
  db.close()
}
