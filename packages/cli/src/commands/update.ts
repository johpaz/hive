const PACKAGES = ["@johpaz/hive-agents-cli"];

export async function update(): Promise<void> {
  console.log("🔄 Actualizando Hive...\n");

  for (const pkg of PACKAGES) {
    console.log(`Actualizando ${pkg}...`);
    try {
      const proc = Bun.spawn(["bun", "install", "-g", `${pkg}@latest`], {
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;
      if (exitCode === 0) {
        console.log(`✅ ${pkg} actualizado\n`);
      } else {
        console.log(`⚠️  Error actualizando ${pkg}\n`);
      }
    } catch (e) {
      console.log(`⚠️  Error actualizando ${pkg}: ${(e as Error).message}\n`);
    }
  }

  console.log("✅ Hive actualizado. Ejecuta 'hive --version' para verificar.");
}
