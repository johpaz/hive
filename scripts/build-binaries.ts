#!/usr/bin/env bun

import { $ } from "bun";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { createHash } from "crypto";

const VERSION = JSON.parse(readFileSync("./package.json", "utf-8")).version;

const PLATFORMS = [
  { name: "linux-x64", os: "linux", arch: "x64" },
  { name: "linux-arm64", os: "linux", arch: "arm64" },
  { name: "macos-x64", os: "macos", arch: "x64" },
  { name: "macos-arm64", os: "macos", arch: "arm64" },
  { name: "windows-x64.exe", os: "windows", arch: "x64" },
];

const OUTPUT_DIR = "./binaries";

async function buildBinary(platform: typeof PLATFORMS[0]) {
  const filename = `hive-v${VERSION}-${platform.name}`;
  console.log(`\n📦 Building ${filename}...`);

  const entryPoint = "./packages/cli/src/index.ts";

  const result = await $`bun build --compile --target=bun-${platform.os}-${platform.arch} ${entryPoint} --outfile=${OUTPUT_DIR}/${filename}`.nothrow();

  if (result.exitCode !== 0) {
    console.error(`❌ Failed to build ${filename}`);
    console.error(result.stderr.toString());
    return false;
  }

  if (platform.name.endsWith(".exe")) {
    console.log(`✅ ${filename} built successfully`);
    return true;
  }

  await $`chmod +x ${OUTPUT_DIR}/${filename}`.quiet();
  console.log(`✅ ${filename} built successfully`);
  return true;
}

async function generateChecksums() {
  console.log("\n🔐 Generating SHA256 checksums...");

  const checksums: string[] = [];

  for (const platform of PLATFORMS) {
    const filename = `hive-v${VERSION}-${platform.name}`;
    const filepath = join(OUTPUT_DIR, filename);

    if (!existsSync(filepath)) {
      console.warn(`⚠️  ${filename} not found, skipping checksum`);
      continue;
    }

    const content = await Bun.file(filepath).arrayBuffer();
    const hash = createHash("sha256").update(Buffer.from(content)).digest("hex");
    checksums.push(`${hash}  ${filename}`);
  }

  const checksumsPath = join(OUTPUT_DIR, `checksums.txt`);
  writeFileSync(checksumsPath, checksums.join("\n") + "\n");
  console.log(`✅ Checksums written to ${checksumsPath}`);
}

async function buildUI() {
  console.log("\n🎨 Building UI...");
  const hiveUiPath = "./packages/hive-ui";
  const result = await $`bun run build`.cwd(hiveUiPath).nothrow();
  if (result.exitCode !== 0) {
    console.error("❌ Failed to build UI\n" + result.stderr.toString());
    return false;
  }
  // Copy dist to binaries/ui-dist for distribution alongside the binary
  await $`cp -r ${hiveUiPath}/dist ${OUTPUT_DIR}/ui-dist`.quiet();
  console.log("✅ UI built → binaries/ui-dist/");
  return true;
}

async function main() {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`🚀 Building Hive binaries v${VERSION}`);
  console.log(`📁 Output directory: ${OUTPUT_DIR}`);

  const uiBuilt = await buildUI();
  if (!uiBuilt) process.exit(1);

  const results = await Promise.all(PLATFORMS.map(buildBinary));

  if (results.every(Boolean)) {
    await generateChecksums();
    console.log("\n✅ All binaries built successfully!");
    console.log(`📁 binaries/${OUTPUT_DIR}`);
  } else {
    console.error("\n❌ Some binaries failed to build");
    process.exit(1);
  }
}

main();
