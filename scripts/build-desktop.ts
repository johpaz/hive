#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const desktopRoot = join(root, "apps", "hive-desktop")
const sidecarDir = join(desktopRoot, "src-tauri", "binaries")
const generatedUi = join(root, "packages", "cli", "src", "ui-bundle.generated.ts")

function run(command: string[], cwd = root): void {
  const result = Bun.spawnSync(command, { cwd, stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) {
    throw new Error(`Falló: ${command.join(" ")}`)
  }
}

function hostTarget(): string {
  const result = Bun.spawnSync(["rustc", "--print", "host-tuple"], { stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) {
    throw new Error("No se pudo obtener el target de Rust. Instala Rust 1.84 o superior.")
  }
  return result.stdout.toString().trim()
}

function bunTarget(target: string): string {
  const mapping: Record<string, string> = {
    "x86_64-unknown-linux-gnu": "bun-linux-x64",
    "aarch64-unknown-linux-gnu": "bun-linux-arm64",
    "x86_64-apple-darwin": "bun-darwin-x64",
    "aarch64-apple-darwin": "bun-darwin-arm64",
    "x86_64-pc-windows-msvc": "bun-windows-x64",
    "aarch64-pc-windows-msvc": "bun-windows-arm64",
  }
  const result = mapping[target]
  if (!result) throw new Error(`Target de escritorio no soportado todavía: ${target}`)
  return result
}

const targetFlagIndex = process.argv.indexOf("--target")
const explicitTarget = targetFlagIndex >= 0 ? process.argv[targetFlagIndex + 1] : undefined
const target = explicitTarget || process.env.TAURI_ENV_TARGET_TRIPLE || hostTarget()
const extension = target.includes("windows") ? ".exe" : ""
const output = join(sidecarDir, `hive-gateway-${target}${extension}`)
const originalGeneratedUi = existsSync(generatedUi) ? readFileSync(generatedUi) : null
const usePrebuiltUi =
  process.argv.includes("--prebuilt-ui") || process.env.HIVE_DESKTOP_PREBUILT_UI === "1"

try {
  mkdirSync(sidecarDir, { recursive: true })
  if (!usePrebuiltUi) {
    run(["bun", "run", "--cwd", "packages/hive-ui", "build"])
  } else if (!existsSync(join(root, "packages", "hive-ui", "dist", "index.html"))) {
    throw new Error("--prebuilt-ui requiere packages/hive-ui/dist/index.html")
  }
  run(["bun", "packages/cli/scripts/generate-ui-bundle.ts"])
  run([
    "bun",
    "scripts/build-gateway.ts",
    "--target",
    bunTarget(target),
    "--outfile",
    output,
  ])
  console.log(`Hive Desktop sidecar listo: ${output}`)
} finally {
  // The embedded UI file is a build artifact. Restore the repository stub so
  // desktop builds do not leave a multi-megabyte generated diff behind.
  if (originalGeneratedUi) {
    await Bun.write(generatedUi, originalGeneratedUi)
  }
}
