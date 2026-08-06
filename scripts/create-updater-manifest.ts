#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

type Platform = "linux-x86_64" | "linux-aarch64" | "darwin-x86_64" | "darwin-aarch64" | "windows-x86_64"

const root = resolve(import.meta.dir, "..")
const artifactsArg = process.argv.indexOf("--artifacts-dir")
const artifactsDir = resolve(root, artifactsArg >= 0 ? process.argv[artifactsArg + 1] : "artifacts")
const versionArg = process.argv.indexOf("--version")
const version = versionArg >= 0 ? process.argv[versionArg + 1] : process.env.GITHUB_REF_NAME?.replace(/^v/, "")
const outputArg = process.argv.indexOf("--output")
const output = resolve(root, outputArg >= 0 ? process.argv[outputArg + 1] : "latest.json")

if (!version) throw new Error("Falta --version o GITHUB_REF_NAME")

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return filesIn(path)
    return entry.isFile() ? [path] : []
  })
}

function findUpdaterAsset(platform: Platform): string {
  const patterns: Record<Platform, RegExp> = {
    "linux-x86_64": /\.AppImage$/,
    "linux-aarch64": /\.AppImage$/,
    "darwin-x86_64": /\.app\.tar\.gz$/i,
    "darwin-aarch64": /\.app\.tar\.gz$/i,
    "windows-x86_64": /\.exe$/i,
  }
  const candidates = filesIn(artifactsDir).filter(
    (path) => patterns[platform].test(path) && !path.includes("hive-v"),
  )
  if (candidates.length !== 1) {
    throw new Error(
      `Se esperaba exactamente un artefacto updater para ${platform}; se encontraron ${candidates.length}:\n${candidates.join("\n")}`,
    )
  }
  return candidates[0]
}

const platforms = {} as Record<string, { signature: string; url: string }>
const releaseBase = `https://github.com/johpaz/hive/releases/download/v${version}`

for (const platform of [
  "linux-x86_64",
  "linux-aarch64",
  "darwin-x86_64",
  "darwin-aarch64",
  "windows-x86_64",
] as Platform[]) {
  const asset = findUpdaterAsset(platform)
  const signaturePath = `${asset}.sig`
  try {
    statSync(signaturePath)
  } catch {
    throw new Error(`Falta la firma updater para ${platform}: ${relative(root, signaturePath)}`)
  }
  platforms[platform] = {
    signature: readFileSync(signaturePath, "utf8").trim(),
    url: `${releaseBase}/${encodeURIComponent(asset.split("/").pop()!)}`,
  }
}

await Bun.write(
  output,
  `${JSON.stringify(
    {
      version,
      notes: `Hive ${version}`,
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
  )}\n`,
)
console.log(`Manifest updater generado: ${output}`)
