#!/usr/bin/env bun

const args = process.argv.slice(2);
const bumpType = args[0] as "patch" | "minor" | "major" | string;
const explicitVersion = args[0]?.match(/^\d+\.\d+\.\d+$/) ? args[0] : null;

if (!bumpType || (!["patch", "minor", "major"].includes(bumpType) && !explicitVersion)) {
  console.log("Usage:");
  console.log("  bun scripts/bump-version.ts patch|minor|major");
  console.log("  bun scripts/bump-version.ts 1.0.5");
  process.exit(1);
}

interface PackageInfo {
  name: string;
  version: string;
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
  const packages = ["cli", "core", "sdk", "mcp", "skills", "hive-ui", "code-bridge"];

  for (const pkg of packages) {
    try {
      const content = await Bun.file(`packages/${pkg}/package.json`).text();
      const json = JSON.parse(content);
      versions.set(json.name, json.version);
    } catch { }
  }
  return versions;
}

async function main() {
  const currentVersions = await getPackageVersions();
  const coreVersion = currentVersions.get("@johpaz/hive-agents-core") || "1.0.0";

  const newVersion = explicitVersion || bumpVersion(coreVersion, bumpType as "patch" | "minor" | "major");

  console.log(`\n📦 Bumping version: ${coreVersion} → ${newVersion}\n`);

  const packageFiles = [
    "package.json",
    "packages/cli/package.json",
    "packages/core/package.json",
    "packages/sdk/package.json",
    "packages/mcp/package.json",
    "packages/skills/package.json",
    "packages/hive-ui/package.json",
    "packages/code-bridge/package.json",

  ];

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

  const tsFiles = [
    {
      path: "packages/cli/src/index.ts",
      pattern: /const VERSION = "[\d.]+"/g,
      replacement: `const VERSION = "${newVersion}"`,
    },
    {
      path: "packages/cli/src/commands/onboard.ts",
      pattern: /const VERSION = "[\d.]+"/g,
      replacement: `const VERSION = "${newVersion}"`,
    },
    {
      path: "packages/cli/src/commands/gateway.ts",
      pattern: /Personal Swarm AI Gateway — v[\d.]+/g,
      replacement: `Personal Swarm AI Gateway — v${newVersion}`,
    },
    {
      path: "README.md",
      pattern: /hive-v[\d.]+/g,
      replacement: `hive-v${newVersion}`,
    },
    {
      path: "README.md",
      pattern: /johpaz\/hive:[\d.]+/g,
      replacement: `johpaz/hive:${newVersion}`,
    },
  ];

  for (const file of tsFiles) {
    try {
      const content = await Bun.file(file.path).text();
      const newContent = content.replace(file.pattern, file.replacement);

      if (newContent !== content) {
        await Bun.write(file.path, newContent);
        console.log(`✅ ${file.path}`);
      }
    } catch (e) {
      console.log(`⚠️  ${file.path}: ${(e as Error).message}`);
    }
  }

  console.log(`\n✨ Done! Version is now ${newVersion}\n`);

  // ── Git: commit, tag y push solo el tag nuevo ──────────────────────────────
  const { execSync } = await import("child_process");
  const run = (cmd: string) => execSync(cmd, { stdio: "inherit" });

  console.log("🔧 Committing changes...");
  run("git add -A");

  try {
    run(`git commit -m "chore: release v${newVersion}"`);
  } catch {
    console.log("   (nothing to commit, skipping)");
  }

  console.log(`🏷️  Creating tag v${newVersion}...`);
  try {
    run(`git tag v${newVersion}`);
  } catch {
    console.log(`   ⚠️  Tag v${newVersion} already exists, skipping`);
  }

  console.log("🚀 Pushing commit and tag...");
  run("git push origin master");
  run(`git push origin v${newVersion}`);

  console.log(`\n🎉 Released v${newVersion}\n`);
}

main().catch(console.error);
