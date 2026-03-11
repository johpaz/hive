import * as p from "@clack/prompts";
import * as fs from "fs";
import * as path from "path";
import { getHiveDir } from "../../../core/src/config/loader";

function showDevBanner(): void {
  const hiveDir = getHiveDir();
  console.log(`
╔══════════════════════════════════════════════════╗
║  🔧  HIVE DEV MODE                               ║
║  Configuración en: ${hiveDir}
║  Tu configuración real en ~/.hive/ no será modificada.    ║
╚══════════════════════════════════════════════════╝
`);
}

export async function dev(): Promise<void> {
  const hiveDir = getHiveDir();
  const dbPath = path.join(hiveDir, "data", "hive.db");

  // Create hiveDir if it doesn't exist
  if (!fs.existsSync(hiveDir)) {
    fs.mkdirSync(hiveDir, { recursive: true });
  }

  // ── Step 1: Si existe sesión anterior, preguntar si limpiar ──
  if (fs.readdirSync(hiveDir).length > 0) {
    const stats = fs.statSync(hiveDir);
    const hoursAgo = Math.floor((Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60));
    const timeAgo = hoursAgo < 1 ? "hace unos minutos" : `hace ${hoursAgo} hora${hoursAgo > 1 ? "s" : ""}`;

    console.log(`\n⚠️  Se encontró una sesión de dev anterior en ${hiveDir}\n    Última configuración: ${timeAgo}\n`);

    const shouldClean = await p.confirm({
      message: "¿Limpiar y empezar de nuevo?",
      initialValue: true,
    });

    if (p.isCancel(shouldClean)) {
      p.cancel("Operación cancelada.");
      process.exit(0);
    }

    if (shouldClean) {
      console.log("🧹 Limpiando entorno de dev anterior...");
      fs.rmSync(hiveDir, { recursive: true, force: true });
      fs.mkdirSync(hiveDir, { recursive: true });
    }
  }

  showDevBanner();

  // ── Step 2: Verificar si ya hay un agente configurado ──
  let hasCompletedAgent = false;

  if (fs.existsSync(dbPath)) {
    try {
      const { initializeDatabase, getDb } = await import("../../../core/src/storage/sqlite");
      initializeDatabase();
      const db = getDb();
      const agent = db.query("SELECT id FROM agents WHERE role = 'coordinator' AND status = 'idle' LIMIT 1").get();
      hasCompletedAgent = !!agent;
    } catch {
      hasCompletedAgent = false;
    }
  }

  // ── Step 3: Si no hay agente, ejecutar onboarding (él crea dir + BD) ──
  if (!hasCompletedAgent) {
    console.log("🚀 Ejecutando onboarding interactivo...\n");
    const { onboard } = await import("./onboard");
    await onboard();

    // Verificar que onboarding creó el agente
    try {
      const { getDb } = await import("../../../core/src/storage/sqlite");
      const db = getDb();
      const agent = db.query("SELECT id FROM agents WHERE role = 'coordinator' AND status = 'idle' LIMIT 1").get();
      if (!agent) {
        console.error("❌ Onboard no creó la configuración en BD");
        process.exit(1);
      }
    } catch (e) {
      console.error("❌ Error verificando configuración:", (e as Error).message);
      process.exit(1);
    }
    console.log("\n✅ Onboarding completado. Arrancando el servidor...\n");
  } else {
    console.log("🚀 Arrancando gateway con configuración existente...\n");
  }

  // ── Step 4: Arrancar gateway ──
  const { start } = await import("./gateway");
  await start(["--skip-check"]);
}
