// Paquete principal de Hive — instala el CLI con todas sus dependencias
const MAIN_PACKAGE = "@johpaz/hive-agents";

export async function update(): Promise<void> {
  console.log("🔄 Actualizando Hive...\n");

  // Detectar tipo de instalación
  const { existsSync } = await import("node:fs");
  const isGitRepo = existsSync(".git") && existsSync("package.json");

  if (isGitRepo) {
    await updateFromGitRepo();
  } else {
    await updateFromGlobalPackage();
  }
}

/**
 * Actualiza desde el repositorio local (git pull + build)
 */
async function updateFromGitRepo(): Promise<void> {
  const { execSync } = await import("child_process");

  // Mostrar versión actual
  try {
    const currentVersion = execSync("bun packages/cli/src/index.ts --version", { encoding: "utf-8" }).trim();
    console.log(`Versión actual: ${currentVersion}`);
  } catch {
    console.log("Versión actual: desconocida");
  }

  console.log("\n📥 Obteniendo cambios del repositorio...");

  try {
    // Verificar que git está disponible
    try {
      execSync("git --version", { encoding: "utf-8" });
    } catch {
      console.log("\n❌ git no está instalado. Instala git o usa: bun install -g @johpaz/hive-agents@latest");
      return;
    }

    // Git pull
    console.log("   Ejecutando git pull...");
    const pullResult = execSync("git pull --rebase", { encoding: "utf-8", stdio: "pipe" });
    if (pullResult.includes("Already up to date")) {
      console.log("   ✅ Ya estás en la última versión");
    } else {
      console.log("   ✅ Cambios obtenidos");

      // Instalar dependencias
      console.log("\n📦 Instalando dependencias...");
      execSync("bun install", { encoding: "utf-8", stdio: "inherit" });

      // Build
      console.log("\n🔨 Construyendo el proyecto...");
      execSync("bun run build", { encoding: "utf-8", stdio: "inherit" });
    }

    // Verificar nueva versión
    try {
      const newVersion = execSync("bun packages/cli/src/index.ts --version", { encoding: "utf-8" }).trim();
      console.log(`\n✅ Hive actualizado: ${newVersion}`);
    } catch {
      console.log("\n✅ Hive actualizado");
    }

    // Aplicar actualizaciones de BD
    await applyDatabaseUpdates();

    console.log("\n   Ejecuta 'hive doctor' para validar el entorno.\n");
  } catch (e) {
    console.log(`\n❌ Error durante la actualización: ${(e as Error).message}`);
    console.log(`   Intenta manualmente: git pull && bun install && bun run build\n`);
  }
}

/**
 * Actualiza desde paquete global (bun install -g)
 */
async function updateFromGlobalPackage(): Promise<void> {
  // Mostrar versión actual antes de actualizar
  try {
    const { execSync } = await import("child_process");
    const currentVersion = execSync("hive --version", { encoding: "utf-8" }).trim();
    console.log(`Versión actual: ${currentVersion}`);
  } catch {
    console.log("Versión actual: desconocida");
  }

  console.log(`\nDescargando ${MAIN_PACKAGE}@latest...`);

  try {
    const proc = Bun.spawn(["bun", "install", "-g", `${MAIN_PACKAGE}@latest`], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.log(`\n⚠️  Error durante la actualización (exit code ${exitCode})`);
      console.log(`   Intenta manualmente: bun install -g ${MAIN_PACKAGE}@latest\n`);
      return;
    }

    console.log(`\n✅ Hive actualizado correctamente.`);

    // ──────────────────────────────────────────────
    // Re-seed de la base de datos existente
    // ──────────────────────────────────────────────
    await applyDatabaseUpdates();

    console.log(`\n   Ejecuta 'hive --version' para verificar la nueva versión.`);
    console.log(`   Ejecuta 'hive doctor' para validar el entorno.\n`);
  } catch (e) {
    console.log(`\n⚠️  No se pudo actualizar: ${(e as Error).message}`);
    console.log(`   Intenta manualmente: bun install -g ${MAIN_PACKAGE}@latest\n`);
  }
}

/**
 * Aplica actualizaciones de schema y seed a la BD existente.
 * Se ejecuta después de una actualización del paquete.
 */
async function applyDatabaseUpdates(): Promise<void> {
  const { existsSync } = await import("node:fs");
  const { getHiveDir } = await import("@johpaz/hive-agents-core/config/loader");
  const path = await import("node:path");

  const dbPath = path.join(getHiveDir(), "data", "hive.db");

  if (!existsSync(dbPath)) {
    console.log(`   ℹ️  No se encontró base de datos existente. Se creará en el próximo 'hive start'.`);
    return;
  }

  console.log(`\n🔄 Verificando base de datos...`);

  try {
    const { initializeDatabase, getDb } = await import("@johpaz/hive-agents-core/storage/sqlite");

    // 1. Inicializar BD y aplicar sync de schema (ensureSchemaSync se ejecuta internamente)
    initializeDatabase();
    console.log(`   ✅ Schema verificado`);

    const db = getDb();

    // 2. Contar datos actuales antes del re-seed
    const toolsBefore = (db.query("SELECT COUNT(*) as n FROM tools").get() as { n: number })?.n ?? 0;
    const modelsBefore = (db.query("SELECT COUNT(*) as n FROM models").get() as { n: number })?.n ?? 0;
    const providersBefore = (db.query("SELECT COUNT(*) as n FROM providers").get() as { n: number })?.n ?? 0;
    const skillsBefore = (db.query("SELECT COUNT(*) as n FROM skills").get() as { n: number })?.n ?? 0;

    // 3. Ejecutar re-seed (idempotente: INSERT OR IGNORE / INSERT OR REPLACE)
    //    IMPORTANTE: NO llamar initHiveLearnStorage aquí — HiveLearn es opt-in.
    //    Los agentes hl_* solo se crean si el usuario los activó en setup o dashboard.
    const { seedAllData } = await import("@johpaz/hive-agents-core/storage/seed");
    seedAllData();

    // 4. Contar datos después del re-seed
    const toolsAfter = (db.query("SELECT COUNT(*) as n FROM tools").get() as { n: number })?.n ?? 0;
    const modelsAfter = (db.query("SELECT COUNT(*) as n FROM models").get() as { n: number })?.n ?? 0;
    const providersAfter = (db.query("SELECT COUNT(*) as n FROM providers").get() as { n: number })?.n ?? 0;
    const skillsAfter = (db.query("SELECT COUNT(*) as n FROM skills").get() as { n: number })?.n ?? 0;

    // 5. Reportar cambios
    const newTools = toolsAfter - toolsBefore;
    const newModels = modelsAfter - modelsBefore;
    const newProviders = providersAfter - providersBefore;
    const newSkills = skillsAfter - skillsBefore;

    if (newTools > 0) console.log(`   📦 +${newTools} nuevas tools`);
    if (newModels > 0) console.log(`   📦 +${newModels} nuevos modelos`);
    if (newProviders > 0) console.log(`   📦 +${newProviders} nuevos providers`);
    if (newSkills > 0) console.log(`   📦 +${newSkills} nuevas skills actualizadas`);

    if (newTools === 0 && newModels === 0 && newProviders === 0 && newSkills === 0) {
      console.log(`   ✅ Datos actualizados, sin cambios nuevos`);
    }

    // 6. Verificar si el gateway está corriendo para sugerir reload
    const hiveDir = getHiveDir();
    const pidFile = path.join(hiveDir, "gateway.pid");
    if (existsSync(pidFile)) {
      console.log(`\n   💡 El gateway está corriendo. Ejecuta 'hive reload' para aplicar cambios.`);
    }
  } catch (err) {
    console.log(`   ⚠️  No se pudo verificar la base de datos: ${(err as Error).message}`);
    console.log(`   💡 Ejecuta 'hive start' para inicializar la base de datos.`);
  }
}
