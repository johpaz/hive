// Paquete principal de Hive — instala el CLI con todas sus dependencias
const MAIN_PACKAGE = "@johpaz/hive-agents";

export async function update(): Promise<void> {
  console.log("🔄 Actualizando Hive...\n");

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

    if (exitCode === 0) {
      console.log(`\n✅ Hive actualizado correctamente.`);
      console.log(`   Ejecuta 'hive --version' para verificar la nueva versión.`);
      console.log(`   Ejecuta 'hive doctor' para validar el entorno.\n`);
    } else {
      console.log(`\n⚠️  Error durante la actualización (exit code ${exitCode})`);
      console.log(`   Intenta manualmente: bun install -g ${MAIN_PACKAGE}@latest\n`);
    }
  } catch (e) {
    console.log(`\n⚠️  No se pudo actualizar: ${(e as Error).message}`);
    console.log(`   Intenta manualmente: bun install -g ${MAIN_PACKAGE}@latest\n`);
  }
}
