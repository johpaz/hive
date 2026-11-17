/**
 * Instalación automática del binario de Obscura en ~/.hive/bin.
 *
 * Se dispara la primera vez que una tool `obscura_*` no encuentra el binario.
 * Baja el release fijado desde GitHub (Apache-2.0), lo extrae con `tar` (en
 * Windows 10+ es bsdtar y también lee .zip) y lo deja listo para el resolvedor.
 * `HIVE_OBSCURA_AUTO_INSTALL=0` lo apaga (entornos sin red o que lo gestionan aparte).
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { logger } from "../../utils/logger.ts"

const log = logger.child("obscura-install")

/** Versión fijada: así una release nueva de Obscura no rompe a Hive sin pasar por un cambio nuestro. */
export const OBSCURA_VERSION = "v0.2.7"
const RELEASE_BASE = `https://github.com/h4ckf0r0day/obscura/releases/download/${OBSCURA_VERSION}`

export function obscuraInstallDir(): string {
  return join(homedir(), ".hive", "bin")
}

export function obscuraBinName(): string {
  return process.platform === "win32" ? "obscura.exe" : "obscura"
}

/** Nombre del asset de la release para este equipo, o null si no hay build. */
export function obscuraAssetName(
  platform: string = process.platform,
  arch: string = process.arch,
): string | null {
  const cpu = arch === "x64" ? "x86_64" : arch === "arm64" ? "aarch64" : null
  if (!cpu) return null
  if (platform === "linux") return `obscura-${cpu}-linux.tar.gz`
  if (platform === "darwin") return `obscura-${cpu}-macos.tar.gz`
  if (platform === "win32" && cpu === "x86_64") return "obscura-x86_64-windows.zip"
  return null
}

function autoInstallEnabled(): boolean {
  const v = process.env.HIVE_OBSCURA_AUTO_INSTALL
  return !(v === "0" || v === "false")
}

function findBinary(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isFile() && entry.name === name) return full
    if (entry.isDirectory()) {
      const nested = findBinary(full, name)
      if (nested) return nested
    }
  }
  return null
}

let inflight: Promise<string | null> | null = null
let lastError: string | null = null

/** Motivo del último intento fallido, para mostrarlo en el mensaje de error. */
export function obscuraInstallError(): string | null {
  return lastError
}

/** Descarga e instala Obscura. Devuelve la ruta del binario o null si falló. Idempotente. */
export function installObscura(): Promise<string | null> {
  if (!autoInstallEnabled()) {
    lastError = "la instalación automática está apagada (HIVE_OBSCURA_AUTO_INSTALL=0)"
    return Promise.resolve(null)
  }
  inflight ??= doInstall().finally(() => { inflight = null })
  return inflight
}

async function doInstall(): Promise<string | null> {
  const asset = obscuraAssetName()
  if (!asset) {
    lastError = `no hay build de Obscura para ${process.platform}/${process.arch}`
    return null
  }
  const dest = join(obscuraInstallDir(), obscuraBinName())
  const work = join(tmpdir(), `hive-obscura-${process.pid}-${Date.now()}`)
  try {
    log.info(`[obscura] no está instalado; descargando ${asset} (${OBSCURA_VERSION})`)
    mkdirSync(work, { recursive: true })
    const res = await fetch(`${RELEASE_BASE}/${asset}`, { redirect: "follow" })
    if (!res.ok) throw new Error(`descarga falló: HTTP ${res.status}`)
    const archive = join(work, asset)
    writeFileSync(archive, new Uint8Array(await res.arrayBuffer()))

    const out = join(work, "out")
    mkdirSync(out)
    const tar = Bun.spawnSync(["tar", "-xf", archive, "-C", out], { stdout: "ignore", stderr: "pipe" })
    if (tar.exitCode !== 0) throw new Error(`no se pudo extraer: ${tar.stderr.toString().trim()}`)

    const found = findBinary(out, obscuraBinName())
    if (!found) throw new Error("el archivo descargado no contiene el binario de Obscura")

    mkdirSync(obscuraInstallDir(), { recursive: true })
    // Escribir y renombrar: nunca queda un binario a medias si el proceso muere.
    const tmpDest = `${dest}.part`
    await Bun.write(tmpDest, Bun.file(found))
    if (process.platform !== "win32") chmodSync(tmpDest, 0o755)
    const { renameSync } = await import("node:fs")
    renameSync(tmpDest, dest)

    if (!existsSync(dest) || statSync(dest).size === 0) throw new Error("la instalación quedó vacía")
    lastError = null
    log.info(`[obscura] instalado en ${dest}`)
    return dest
  } catch (err) {
    lastError = (err as Error).message
    log.warn(`[obscura] instalación automática falló: ${lastError}`)
    return null
  } finally {
    try { rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}
