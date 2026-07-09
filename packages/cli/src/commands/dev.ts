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
  const dbPath = path.join(hiveDir, "data", "hivedb");

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

  console.log("🚀 Arrancando gateway...\n");

  // El setup web maneja la configuración inicial — abre automáticamente /setup si es primera vez
  const { start } = await import("./gateway");
  await start(["--skip-check"]);
}
