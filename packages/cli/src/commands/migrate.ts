/**
 * Migrate Command — Fuerza la migración de schema y re-seed de datos
 *
 * Útil cuando:
 * - Se actualizó el paquete pero el seed no se aplicó
 * - Se agregaron nuevas tools/models/providers al seed
 * - Se necesitan crear columnas nuevas en tablas existentes
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getHiveDir } from "@johpaz/hive-agents-core/config/loader";

export async function migrate(): Promise<void> {
  console.log("\n🔄 Migrando base de datos de Hive...\n");

  const dbPath = path.join(getHiveDir(), "data", "hive.db");

  if (!fs.existsSync(dbPath)) {
    console.log("⚠️  No se encontró base de datos existente.");
    console.log("   Ejecuta 'hive start' o 'hive onboard' para crear una nueva.\n");
    return;
  }

  try {
    const { initializeDatabase, getDb } = await import("@johpaz/hive-agents-core/storage/sqlite");

    // 1. Inicializar BD y aplicar sync de schema
    console.log("📐 Verificando schema...");
    initializeDatabase();
    console.log("   ✅ Schema sincronizado");

    const db = getDb();

    // 2. Contar datos actuales
    const toolsBefore = (db.query("SELECT COUNT(*) as n FROM tools").get() as { n: number })?.n ?? 0;
    const modelsBefore = (db.query("SELECT COUNT(*) as n FROM models").get() as { n: number })?.n ?? 0;
    const providersBefore = (db.query("SELECT COUNT(*) as n FROM providers").get() as { n: number })?.n ?? 0;
    const skillsBefore = (db.query("SELECT COUNT(*) as n FROM skills").get() as { n: number })?.n ?? 0;
    const playbookBefore = (db.query("SELECT COUNT(*) as n FROM playbook").get() as { n: number })?.n ?? 0;

    // 3. Ejecutar re-seed (idempotente)
    console.log("\n🌱 Aplicando seed de datos...");
    const { seedAllData } = await import("@johpaz/hive-agents-core/storage/seed");
    seedAllData();

    // 4. Contar datos después
    const toolsAfter = (db.query("SELECT COUNT(*) as n FROM tools").get() as { n: number })?.n ?? 0;
    const modelsAfter = (db.query("SELECT COUNT(*) as n FROM models").get() as { n: number })?.n ?? 0;
    const providersAfter = (db.query("SELECT COUNT(*) as n FROM providers").get() as { n: number })?.n ?? 0;
    const skillsAfter = (db.query("SELECT COUNT(*) as n FROM skills").get() as { n: number })?.n ?? 0;
    const playbookAfter = (db.query("SELECT COUNT(*) as n FROM playbook").get() as { n: number })?.n ?? 0;

    // 5. Reportar cambios
    console.log("\n📊 Resumen de cambios:");

    const changes: Array<{ name: string; before: number; after: number }> = [
      { name: "Tools", before: toolsBefore, after: toolsAfter },
      { name: "Models", before: modelsBefore, after: modelsAfter },
      { name: "Providers", before: providersBefore, after: providersAfter },
      { name: "Skills", before: skillsBefore, after: skillsAfter },
      { name: "Playbook Rules", before: playbookBefore, after: playbookAfter },
    ];

    let hadChanges = false;
    for (const c of changes) {
      const diff = c.after - c.before;
      if (diff > 0) {
        console.log(`   ✅ +${diff} ${c.name.toLowerCase()}`);
        hadChanges = true;
      }
    }

    if (!hadChanges) {
      console.log("   ✅ Todo actualizado, sin cambios nuevos");
    }

    // 6. Sugerir reload si gateway está corriendo
    const pidFile = path.join(getHiveDir(), "gateway.pid");
    if (fs.existsSync(pidFile)) {
      console.log("\n   💡 El gateway está corriendo. Ejecuta 'hive reload' para aplicar cambios.");
    }

    console.log("\n✅ Migración completada.\n");
  } catch (err) {
    console.error(`\n❌ Error durante la migración: ${(err as Error).message}`);
    console.error("   💡 Ejecuta 'hive doctor' para más diagnóstico.\n");
    process.exit(1);
  }
}
