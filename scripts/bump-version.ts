#!/usr/bin/env bun

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const shouldPush = args.includes("--push");
const positional = args.filter((a) => !a.startsWith("--"));
const bumpType = positional[0] as "patch" | "minor" | "major" | string;
const explicitVersion = positional[0]?.match(/^\d+\.\d+\.\d+$/) ? positional[0] : null;

if (!bumpType || (!["patch", "minor", "major"].includes(bumpType) && !explicitVersion)) {
  console.log("Usage:");
  console.log("  bun scripts/bump-version.ts patch|minor|major [--push] [--dry-run]");
  console.log("  bun scripts/bump-version.ts 1.0.5 [--push] [--dry-run]");
  console.log("");
  console.log("  (sin flags)  Solo actualiza archivos locales (package.json, README, docs).");
  console.log("               No toca git. Revisá el diff vos mismo.");
  console.log("  --dry-run    Muestra qué cambiaría, sin escribir nada.");
  console.log("  --push       Además de bumpear, commitea, tagea y publica (git push + tag),");
  console.log("               con confirmación antes de publicar.");
  process.exit(1);
}

function bumpVersion(current: string, type: "patch" | "minor" | "major"): string {
  const [major, minor, patch] = current.split(".").map(Number);
  return type === "major"
    ? `${major + 1}.0.0`
    : type === "minor"
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;
}

async function getPackageVersions(): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  const packages = ["cli", "core", "mcp", "skills", "hive-ui"];

  for (const pkg of packages) {
    try {
      const content = await Bun.file(`packages/${pkg}/package.json`).text();
      const json = JSON.parse(content);
      versions.set(json.name, json.version);
    } catch { }
  }
  return versions;
}

async function confirm(message: string): Promise<boolean> {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${message} (escribe "si" para confirmar): `);
  rl.close();
  return answer.trim().toLowerCase() === "si";
}

const packageFiles = [
  "package.json",
  "packages/cli/package.json",
  "packages/core/package.json",
  "packages/mcp/package.json",
  "packages/skills/package.json",
  "packages/hive-ui/package.json",
  // La app de escritorio (Tauri) vive fuera de `workspaces` y por eso queda
  // afuera de todo lo anterior si no se lista explícitamente. Sin esto, el
  // updater anuncia una versión que el binario instalado no reconoce como
  // "más nueva que la mía" y vuelve a ofrecer la misma actualización siempre.
  "apps/hive-desktop/package.json",
  "apps/hive-desktop/src-tauri/tauri.conf.json",
];

// packages/cli/src/index.ts, commands/onboard.ts y commands/gateway.ts leen la
// versión de ../package.json en runtime — no necesitan patch. Estas son las
// únicas menciones de versión en prosa/instrucciones que sí quedan hardcodeadas.
function textReplacements(newVersion: string) {
  return [
    { path: "README.md", pattern: /johpaz\/hive-agents:[\d.]+/g, replacement: `johpaz/hive-agents:${newVersion}` },
    { path: "README.md", pattern: /bun add --global @johpaz\/hive-agents@[\d.]+/g, replacement: `bun add --global @johpaz/hive-agents@${newVersion}` },
    { path: "README.md", pattern: /badge\/versi%C3%B3n-[\d.]+-/g, replacement: `badge/versi%C3%B3n-${newVersion}-` },
    { path: "docs/guides/instalacion.md", pattern: /johpaz\/hive-agents:[\d.]+/g, replacement: `johpaz/hive-agents:${newVersion}` },
    { path: "docs/guides/instalacion.md", pattern: /bun add --global @johpaz\/hive-agents@[\d.]+/g, replacement: `bun add --global @johpaz/hive-agents@${newVersion}` },
    {
      path: "apps/hive-desktop/src-tauri/Cargo.toml",
      // Única línea `version = "..."` sin indentar: la de [package]. Las
      // dependencias fijan versión inline (`dep = { version = "..." }`),
      // nunca como línea propia al inicio — el patrón no las toca.
      pattern: /^version = "[\d.]+"/m,
      replacement: `version = "${newVersion}"`,
    },
    {
      path: "apps/hive-desktop/src-tauri/Cargo.lock",
      // Acotado al bloque [[package]] de hive-desktop (el crate raíz), no a
      // cualquier dependencia externa que también declare "version".
      pattern: /(\[\[package\]\]\nname = "hive-desktop"\nversion = ")[\d.]+(")/,
      replacement: `$1${newVersion}$2`,
    },
  ];
}

async function main() {
  const currentVersions = await getPackageVersions();
  const coreVersion = currentVersions.get("@johpaz/hive-agents-core") || "1.0.0";
  const newVersion = explicitVersion || bumpVersion(coreVersion, bumpType as "patch" | "minor" | "major");

  console.log(`\n📦 Bumping version: ${coreVersion} → ${newVersion}\n`);

  if (dryRun) {
    console.log("🔎 Dry run — nada se escribe.\n");
    for (const filePath of packageFiles) {
      try {
        const json = JSON.parse(await Bun.file(filePath).text());
        console.log(`  ${filePath}: ${json.version} → ${newVersion}`);
      } catch (e) {
        console.log(`  ⚠️  ${filePath}: ${(e as Error).message}`);
      }
    }
    for (const file of textReplacements(newVersion)) {
      try {
        const content = await Bun.file(file.path).text();
        // Un conteo de "N coincidencias" vía content.match() es engañoso para
        // los patrones con grupos de captura (Cargo.lock): sin flag /g,
        // match() devuelve [matchCompleto, ...grupos], así que .length cuenta
        // grupos, no ocurrencias. Solo importa si matcheó o no.
        const matched = file.pattern.test(content);
        file.pattern.lastIndex = 0; // test() con /g deja el regex con estado
        console.log(`  ${file.path}: ${matched ? "coincide" : "sin coincidencias (revisar patrón)"}`);
      } catch (e) {
        console.log(`  ⚠️  ${file.path}: ${(e as Error).message}`);
      }
    }
    console.log(`\n  Luego regeneraría docs/reference/inventario.md (bun run docs:generate).`);
    if (shouldPush) {
      console.log(`  Luego: git add -A && git commit -m "chore: release v${newVersion}" && git tag v${newVersion} && git push origin master && git push origin v${newVersion}`);
    } else {
      console.log(`  Sin --push: no se toca git.`);
    }
    return;
  }

  for (const filePath of packageFiles) {
    try {
      const content = await Bun.file(filePath).text();
      const json = JSON.parse(content);
      const oldVersion = json.version;

      json.version = newVersion;

      if (json.dependencies) {
        for (const dep of Object.keys(json.dependencies)) {
          if (dep.startsWith("@johpaz/hive-agents-")) {
            json.dependencies[dep] = `^${newVersion}`;
          }
        }
      }

      if (json.peerDependencies) {
        for (const dep of Object.keys(json.peerDependencies)) {
          if (dep.startsWith("@johpaz/hive-agents-")) {
            json.peerDependencies[dep] = `^${newVersion}`;
          }
        }
      }

      await Bun.write(filePath, JSON.stringify(json, null, 2) + "\n");
      console.log(`✅ ${filePath}`);
      if (json.name) {
        console.log(`   ${json.name}: ${oldVersion} → ${newVersion}`);
      }
    } catch (e) {
      console.log(`⚠️  ${filePath}: ${(e as Error).message}`);
    }
  }

  for (const file of textReplacements(newVersion)) {
    try {
      const content = await Bun.file(file.path).text();
      const matched = file.pattern.test(content);
      file.pattern.lastIndex = 0; // test() con /g deja el regex con estado — resetear antes de usarlo de nuevo
      const newContent = content.replace(file.pattern, file.replacement);

      if (!matched) {
        console.log(`⚠️  ${file.path}: el patrón ${file.pattern} no matcheó nada — revisar manualmente`);
      } else if (newContent !== content) {
        await Bun.write(file.path, newContent);
        console.log(`✅ ${file.path}`);
      } else {
        console.log(`✅ ${file.path} (ya estaba en ${newVersion}, sin cambios)`);
      }
    } catch (e) {
      console.log(`⚠️  ${file.path}: ${(e as Error).message}`);
    }
  }

  const { execSync } = await import("child_process");
  const run = (cmd: string) => execSync(cmd, { stdio: "inherit" });

  console.log("\n📚 Regenerando docs/reference/inventario.md...");
  try {
    run("bun run docs:generate");
  } catch (e) {
    console.log(`⚠️  docs:generate falló: ${(e as Error).message}`);
  }

  console.log(`\n✨ Archivos actualizados. Versión: ${newVersion}\n`);

  if (!shouldPush) {
    console.log("Sin --push: no se tocó git. Revisá `git diff`, y cuando estés conforme:");
    console.log(`  bun scripts/bump-version.ts ${explicitVersion || bumpType} --push\n`);
    return;
  }

  // ── Git: commit, tag y push — con confirmación antes de publicar ──────────
  console.log("Esto es lo que se va a commitear (git add -A):\n");
  run("git status --short");

  const tagExists = (() => {
    try {
      execSync(`git rev-parse v${newVersion}`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  if (tagExists) {
    console.log(`\n⚠️  El tag v${newVersion} ya existe localmente. Esto suele indicar que esta`);
    console.log(`   versión ya se publicó antes. Abortando — si es intencional, borrá el tag`);
    console.log(`   primero (git tag -d v${newVersion}) y volvé a correr con --push.`);
    process.exit(1);
  }

  console.log(`\nEsto va a: commitear todo lo de arriba como "chore: release v${newVersion}",`);
  console.log(`crear el tag v${newVersion}, y pushear master + el tag a origin.`);
  console.log(`El push del tag dispara release.yml — publica en npm y Docker Hub.\n`);

  const ok = await confirm(`¿Publicar v${newVersion}?`);
  if (!ok) {
    console.log("Cancelado. No se tocó git.");
    return;
  }

  console.log("🔧 Committing changes...");
  run("git add -A");
  try {
    run(`git commit -m "chore: release v${newVersion}"`);
  } catch {
    console.log("   (nothing to commit, skipping)");
  }

  console.log(`🏷️  Creating tag v${newVersion}...`);
  run(`git tag v${newVersion}`);

  console.log("🚀 Pushing commit and tag...");
  run("git push origin master");
  run(`git push origin v${newVersion}`);

  console.log(`\n🎉 Released v${newVersion}\n`);
}

main().catch(console.error);
