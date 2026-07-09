/**
 * Migrate Command — Fuerza el re-seed de datos predeterminados
 *
 * Útil cuando:
 * - Se actualizó el paquete pero el seed no se aplicó
 * - Se agregaron nuevas tools/models/providers al seed
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getHiveDir } from "@johpaz/hive-agents-core/config/loader";

export async function migrate(): Promise<void> {
  console.log("\n🔄 Re-aplicando seed de datos de Hive...\n");

  const dbPath = path.join(getHiveDir(), "data", "hivedb");

  if (!fs.existsSync(dbPath)) {
    console.log("⚠️  No se encontró base de datos existente.");
    console.log("   Ejecuta 'hive start' o 'hive onboard' para crear una nueva.\n");
    return;
  }

  try {
    const { ensureHiveDb } = await import("@johpaz/hive-agents-core/storage/bootstrap");
    const { col } = await import("@johpaz/hive-agents-core/storage/hive");

    const countAll = async () => ({
      tools: await (await col("tools")).count(),
      models: await (await col("models")).count(),
      providers: await (await col("providers")).count(),
      skills: await (await col("skills")).count(),
      playbook: await (await col("playbook")).count(),
    });

    const before = await countAll();

    console.log("🌱 Aplicando seed de datos...");
    await ensureHiveDb();

    const after = await countAll();

    console.log("\n📊 Resumen de cambios:");
    const changes: Array<{ name: string; before: number; after: number }> = [
      { name: "Tools", before: before.tools, after: after.tools },
      { name: "Models", before: before.models, after: after.models },
      { name: "Providers", before: before.providers, after: after.providers },
      { name: "Skills", before: before.skills, after: after.skills },
      { name: "Playbook Rules", before: before.playbook, after: after.playbook },
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
