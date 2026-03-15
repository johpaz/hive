#!/usr/bin/env bun
/**
 * publish-sdk.ts
 *
 * Publica @johpaz/hive-sdk a npm de forma aislada.
 *
 * Uso:
 *   bun scripts/publish-sdk.ts           # publica la versión actual
 *   bun scripts/publish-sdk.ts patch     # bump patch y publica
 *   bun scripts/publish-sdk.ts minor     # bump minor y publica
 *   bun scripts/publish-sdk.ts major     # bump major y publica
 *   bun scripts/publish-sdk.ts 1.2.0     # versión explícita y publica
 *   bun scripts/publish-sdk.ts --dry-run # simula sin publicar
 */

import { execSync } from "child_process";
import { existsSync } from "fs";

const SDK_DIR = "packages/sdk";
const SDK_PKG = `${SDK_DIR}/package.json`;

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const versionArg = args.find((a) => a !== "--dry-run");

const isExplicitVersion = versionArg?.match(/^\d+\.\d+\.\d+$/);
const isBumpType =
  versionArg && ["patch", "minor", "major"].includes(versionArg);

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd: string, opts: { cwd?: string; silent?: boolean } = {}) {
  const label = opts.cwd ? `[${opts.cwd}] ${cmd}` : cmd;
  if (!opts.silent) console.log(`  $ ${label}`);
  return execSync(cmd, {
    cwd: opts.cwd ?? process.cwd(),
    stdio: opts.silent ? "pipe" : "inherit",
    encoding: "utf8",
  });
}

function bump(current: string, type: "patch" | "minor" | "major"): string {
  const [major, minor, patch] = current.split(".").map(Number);
  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(SDK_PKG)) {
    console.error(`Error: no se encontró ${SDK_PKG}`);
    process.exit(1);
  }

  const sdkJson = JSON.parse(await Bun.file(SDK_PKG).text());
  const currentVersion: string = sdkJson.version;

  // Calcular nueva versión
  let newVersion = currentVersion;
  if (isExplicitVersion) {
    newVersion = versionArg!;
  } else if (isBumpType) {
    newVersion = bump(currentVersion, versionArg as "patch" | "minor" | "major");
  }

  const versionChanged = newVersion !== currentVersion;

  console.log("\n📦  Hive SDK — Publicación");
  console.log(`    Versión actual : ${currentVersion}`);
  if (versionChanged) {
    console.log(`    Nueva versión  : ${newVersion}`);
  }
  if (dryRun) console.log("    Modo           : DRY RUN (sin cambios reales)\n");
  else console.log("");

  // ── 1. Typecheck ──────────────────────────────────────────────────────────
  console.log("🔍  Verificando tipos...");
  try {
    run("bun run typecheck", { cwd: SDK_DIR });
  } catch {
    console.error("\n❌  Typecheck falló. Corrige los errores antes de publicar.");
    process.exit(1);
  }
  console.log("✅  Tipos OK\n");

  // ── 2. Bump versión en package.json del SDK ───────────────────────────────
  if (versionChanged) {
    console.log(`🔖  Actualizando versión a ${newVersion}...`);
    sdkJson.version = newVersion;

    // Actualizar dependencias internas @johpaz/hive-*
    for (const section of ["dependencies", "peerDependencies"] as const) {
      if (sdkJson[section]) {
        for (const dep of Object.keys(sdkJson[section])) {
          if (dep.startsWith("@johpaz/hive-")) {
            sdkJson[section][dep] = `^${newVersion}`;
          }
        }
      }
    }

    if (!dryRun) {
      await Bun.write(SDK_PKG, JSON.stringify(sdkJson, null, 2) + "\n");
      console.log(`✅  ${SDK_PKG} actualizado\n`);
    } else {
      console.log(`   [DRY RUN] Se escribiría ${SDK_PKG}\n`);
    }
  }

  // ── 3. Verificar que hay sesión npm activa ────────────────────────────────
  console.log("🔐  Verificando sesión npm...");
  try {
    const whoami = run("npm whoami", { silent: true }).trim();
    console.log(`✅  Autenticado como: ${whoami}\n`);
  } catch {
    console.error("❌  No estás autenticado en npm. Ejecuta: npm login");
    process.exit(1);
  }

  // ── 4. Publicar ──────────────────────────────────────────────────────────
  const tag = newVersion.includes("-") ? "--tag next" : "--tag latest";
  const accessFlag = "--access public";
  const dryFlag = dryRun ? "--dry-run" : "";

  const publishCmd = `npm publish ${accessFlag} ${tag} ${dryFlag}`.trim().replace(/\s+/g, " ");

  console.log(`🚀  Publicando ${sdkJson.name}@${newVersion}...`);
  run(publishCmd, { cwd: SDK_DIR });

  // ── 5. Git tag (solo si no es dry-run y cambió la versión) ────────────────
  if (!dryRun && versionChanged) {
    const tagName = `sdk-v${newVersion}`;
    console.log(`\n🏷️   Creando git tag ${tagName}...`);
    try {
      run(`git add ${SDK_PKG}`, { silent: true });
      run(`git commit -m "chore(sdk): release v${newVersion}"`, { silent: true });
      run(`git tag ${tagName}`, { silent: true });
      console.log(`✅  Tag creado. Para hacer push: git push && git push origin ${tagName}`);
    } catch (e) {
      console.log("⚠️   No se pudo crear el git tag:", (e as Error).message);
    }
  }

  console.log(`\n✨  ${dryRun ? "[DRY RUN] " : ""}${sdkJson.name}@${newVersion} publicado con éxito.\n`);
}

main().catch((e) => {
  console.error("\n❌  Error:", e.message);
  process.exit(1);
});
