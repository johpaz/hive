#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

type Platform = "linux-x86_64" | "linux-aarch64" | "darwin-x86_64" | "darwin-aarch64" | "windows-x86_64"

// Nombre del artefacto que `actions/upload-artifact` sube por cada entrada de
// la matriz del job `build-desktop` (release.yml): `desktop-${matrix.platform.name}`.
// La matriz nombra macOS como "macos-*"; el manifiesto del updater de Tauri
// usa "darwin-*" — de ahí el mapeo explícito en vez de una transformación de
// texto.
const ARTIFACT_DIR_BY_PLATFORM: Record<Platform, string> = {
  "linux-x86_64": "desktop-linux-x86_64",
  "linux-aarch64": "desktop-linux-aarch64",
  "darwin-x86_64": "desktop-macos-x86_64",
  "darwin-aarch64": "desktop-macos-aarch64",
  "windows-x86_64": "desktop-windows-x86_64",
}

// Desde tauri-plugin-updater 2.10.x (fijado en Cargo.lock) el updater firma
// TODOS los formatos que se construyan: Deb+Rpm+AppImage en Linux, NSIS+MSI
// en Windows. `latest.json` solo admite un asset por plataforma, así que se
// fija un orden de preferencia explícito en vez de exigir una única firma:
//   - Linux: Deb, con Rpm como respaldo. AppImage sería preferible (autoactualiza
//     sin privilegios, a diferencia de Deb/Rpm que van vía pkexec/dpkg/rpm), pero
//     está fuera de "bundles" en release.yml — linuxdeploy revienta al escanear
//     con `ldd` nuestro sidecar hive-gateway (compilado con Bun). Ver ese archivo.
//     Cuando AppImage vuelva, reordenar esta lista para preferirlo de nuevo.
//   - Windows: NSIS. Es el formato que Tauri recomienda para el updater
//     ("MSI installers have some limitations that prevent good update UX").
//   - macOS: solo el bundle `app` genera `.app.tar.gz` + firma; no hay
//     ambigüedad aunque también se construya `dmg` (dmg no es un formato de
//     updater válido en Tauri, así que nunca produce `.sig`).
const PREFERRED_SUFFIXES: Record<Platform, string[]> = {
  "linux-x86_64": [".deb.sig", ".rpm.sig"],
  "linux-aarch64": [".deb.sig", ".rpm.sig"],
  "darwin-x86_64": [".app.tar.gz.sig"],
  "darwin-aarch64": [".app.tar.gz.sig"],
  "windows-x86_64": ["-setup.exe.sig", ".msi.sig"],
}

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

// Cada plataforma sube su propio artefacto (`desktop-<name>`), así que basta
// con mirar dentro de su directorio: eso ya descarta por sí solo la ambigüedad
// entre arquitecturas (ej. linux-x86_64 vs linux-aarch64) que antes hacía
// fallar el manifiesto. Dentro de ese directorio puede haber más de un `.sig`
// (ver PREFERRED_SUFFIXES); se resuelve por preferencia y, si ninguno
// coincide con lo esperado, se falla con un mensaje explícito en vez de
// adivinar.
function findUpdaterAsset(platform: Platform): string {
  const platformDir = join(artifactsDir, ARTIFACT_DIR_BY_PLATFORM[platform])
  let signatures: string[]
  try {
    signatures = filesIn(platformDir).filter((path) => path.endsWith(".sig"))
  } catch {
    throw new Error(`No se encontró el directorio de artefactos para ${platform}: ${relative(root, platformDir)}`)
  }
  if (signatures.length === 0) {
    throw new Error(`No se encontró ninguna firma updater (.sig) para ${platform} en ${relative(root, platformDir)}`)
  }
  for (const suffix of PREFERRED_SUFFIXES[platform]) {
    const match = signatures.find((path) => path.endsWith(suffix))
    if (match) return match.replace(/\.sig$/, "")
  }
  throw new Error(
    `Ninguna firma updater para ${platform} coincide con los sufijos esperados (${PREFERRED_SUFFIXES[platform].join(", ")}); se encontraron:\n${signatures.join("\n")}`,
  )
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
