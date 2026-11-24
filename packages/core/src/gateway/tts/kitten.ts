import { existsSync } from "node:fs"
import { copyFile, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import pkg from "../../../../../package.json"
import { getHiveDir } from "../../config/loader"
import { logger } from "../../utils/logger"
import { DEFAULT_LOCAL_VOICE, LOCAL_TTS_MODEL } from "../../voice/local-model"
import { detectKittenPackage } from "./src/detect"
import builderSource from "./build.py" with { type: "text" }
import workerSource from "./worker.py" with { type: "text" }

const log = logger.child("kitten")
const platform = `${process.platform}-${process.arch}`

type Phase = "stopped" | "installing" | "starting" | "ready" | "error"
interface ServerInfo {
  port: number
  voices: Record<string, string>
}

let phase: Phase = "stopped"
let error: string | undefined
let work: Promise<void> | undefined
let cancellation: AbortController | undefined
let child: ReturnType<typeof launch> | undefined
let server: (ServerInfo & { token: string }) | undefined
let installRoot: string | undefined

function bundlePath() {
  if (!installRoot) {
    const home = getHiveDir()
    installRoot = join(process.env.HIVE_TTS_ROOT ?? join(home, "tts"), "kitten")
  }
  return join(installRoot, `${pkg.version}-${platform}`)
}

function python(dir: string) {
  return process.platform === "win32" ? join(dir, "python", "python.exe") : join(dir, "python", "bin", "python3.12")
}

function installed(dir = bundlePath()) {
  return ["worker.py", "model/config.json", "model/vocab.json", "model/voices_es.npz", "model/kitten_tts_2_mini_int4.onnx"]
    .every(file => existsSync(join(dir, file))) && existsSync(python(dir))
}

function launch(token: string) {
  const bundle = bundlePath()
  return Bun.spawn([python(bundle), "-I", "-B", join(bundle, "worker.py")], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    // En Windows el gateway corre sin consola (sidecar de Tauri): sin esto cada proceso hijo abre una ventana negra.
    windowsHide: true,
    env: { ...process.env, HIVE_KITTEN_TOKEN: token, HF_HUB_OFFLINE: "1" },
  })
}

async function readReady(proc: ReturnType<typeof launch>): Promise<ServerInfo> {
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let output = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) throw new Error("Kitten terminó antes de cargar el modelo")
      output += decoder.decode(value, { stream: true })
      if (output.length > 8192) throw new Error("Respuesta de inicio de Kitten inválida")
      const end = output.indexOf("\n")
      if (end === -1) continue
      const info = JSON.parse(output.slice(0, end)) as ServerInfo
      if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535 || !info.voices?.[DEFAULT_LOCAL_VOICE]) {
        throw new Error("Respuesta de inicio de Kitten inválida")
      }
      return info
    }
  } finally {
    reader.releaseLock()
  }
}

class DownloadError extends Error {
  constructor(url: string, readonly status: number) {
    super(`No se pudo descargar ${url.slice(url.lastIndexOf("/") + 1)} (HTTP ${status})`)
  }
}

async function download(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]) })
  if (!response.ok || !response.body) throw new DownloadError(url, response.status)
  return response
}

async function verifyChecksum(archive: string, checksum: string, name: string) {
  const hash = new Bun.CryptoHasher("sha256")
  for await (const bytes of Bun.file(archive).stream()) hash.update(bytes)
  if (hash.digest("hex") !== checksum.trim().split(/\s+/)[0]) throw new Error(`Checksum de ${name} inválido`)
}

async function unpack(archive: string, destination: string, signal: AbortSignal) {
  await mkdir(destination)
  const tar = Bun.spawn(["tar", "-xf", archive, "-C", destination], { stderr: "pipe", signal, windowsHide: true })
  const [code, stderr] = await Promise.all([tar.exited, new Response(tar.stderr).text()])
  signal.throwIfAborted()
  if (code !== 0) throw new Error(`No se pudo extraer el paquete: ${stderr.trim()}`)
}

type KittenPackage = NonNullable<ReturnType<typeof detectKittenPackage>>

async function downloadBundle(target: KittenPackage, staging: string, signal: AbortSignal) {
  const archive = join(staging, target.filename)
  const localArchive = process.env.HIVE_KITTEN_ARCHIVE
  const checksum = localArchive
    ? await readFile(`${localArchive}.sha256`, "utf8")
    : await (await download(target.checksumUrl, signal)).text()
  if (localArchive) await copyFile(localArchive, archive)
  else await Bun.write(archive, await download(target.url, signal))
  await verifyChecksum(archive, checksum, "Kitten")
  return archive
}

async function installFromUpstream(target: KittenPackage, staging: string, unpacked: string, signal: AbortSignal) {
  log.info(`Kitten aún no tiene un paquete publicado para Hive v${pkg.version}. Instalando desde sus fuentes oficiales.`)
  const uvArchive = join(staging, target.uv.filename)
  const uvRoot = join(staging, "uv")
  await Bun.write(uvArchive, await download(target.uv.url, signal))
  await verifyChecksum(uvArchive, target.uv.sha256, "uv")
  await unpack(uvArchive, uvRoot, signal)
  const flatPath = join(uvRoot, target.uv.executable)
  const uv = existsSync(flatPath) ? flatPath : join(uvRoot, target.uv.directory, target.uv.executable)

  const builder = join(staging, "build-kitten.py")
  const worker = join(staging, "worker.py")
  await Promise.all([Bun.write(builder, builderSource), Bun.write(worker, workerSource)])
  signal.throwIfAborted()
  const install = Bun.spawn([
    uv, "run", "--no-config", "--no-project", "--no-env-file", "--managed-python", "--python", "3.12.13",
    "python", "-I", "-B", builder, unpacked, "--worker", worker, "--unpacked",
  ], {
    cwd: staging,
    signal: AbortSignal.any([signal, AbortSignal.timeout(600_000)]),
    stdout: "inherit", stderr: "inherit",
    windowsHide: true,
    env: {
      ...process.env,
      HIVE_KITTEN_UV: uv,
      UV_CACHE_DIR: join(staging, "uv-cache"),
      UV_PYTHON_INSTALL_DIR: join(staging, "managed"),
      UV_NO_CONFIG: "1",
      UV_NO_PROGRESS: "1",
    },
  })
  const code = await install.exited
  signal.throwIfAborted()
  if (code !== 0) throw new Error(`Falló la instalación de Kitten desde sus fuentes oficiales (código ${code})`)
}

async function install(signal: AbortSignal) {
  const target = detectKittenPackage(pkg.version)
  if (!target) throw new Error(`Kitten no está disponible para ${platform}`)
  const bundle = bundlePath()
  const parent = join(bundle, "..")
  await mkdir(parent, { recursive: true })
  const staging = await mkdtemp(join(parent, ".install-"))
  try {
    const unpacked = join(staging, "bundle")
    try {
      const archive = await downloadBundle(target, staging, signal)
      await unpack(archive, unpacked, signal)
    } catch (cause) {
      if (!(cause instanceof DownloadError && cause.status === 404)) throw cause
      await installFromUpstream(target, staging, unpacked, signal)
    }
    signal.throwIfAborted()
    if (!installed(unpacked)) throw new Error("Paquete Kitten incompleto")
    try {
      await rename(unpacked, bundle)
    } catch (cause) {
      if (!installed()) throw cause
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

export function getLocalTTSStatus() {
  return {
    phase, installed: installed(), running: phase === "ready", installing: phase === "installing",
    modelId: LOCAL_TTS_MODEL, error, voices: getLocalVoices(),
  }
}

export function getLocalVoices() {
  return Object.entries(server?.voices ?? {}).map(([id, name]) => ({ id, name: id === "lucia" ? "Lucía" : name }))
}

export function startLocalTTS(): boolean {
  if (work || child) return false
  const signal = (cancellation = new AbortController()).signal
  error = undefined
  phase = installed() ? "starting" : "installing"
  work = (async () => {
    if (!installed()) await install(signal)
    signal.throwIfAborted()
    phase = "starting"
    const token = randomUUID()
    const proc = (child = launch(token))
    const startup = setTimeout(() => proc.kill(), 30_000)
    void proc.exited.then(code => {
      if (child !== proc) return
      child = undefined
      server = undefined
      phase = "error"
      error = `Kitten se detuvo (código ${code})`
    })
    try {
      const info = await readReady(proc)
      if (signal.aborted || child !== proc) return
      server = { ...info, token }
      phase = "ready"
      log.info("Kitten TTS local listo")
    } finally {
      clearTimeout(startup)
    }
  })().catch(cause => {
    if (signal.aborted) return
    const proc = child
    child = undefined
    proc?.kill()
    phase = "error"
    error = cause instanceof Error ? cause.message : String(cause)
    log.warn(error)
  }).finally(() => {
    work = undefined
    cancellation = undefined
  })
  return true
}

export async function stopLocalTTS() {
  cancellation?.abort()
  const proc = child
  child = undefined
  server = undefined
  phase = "stopped"
  error = undefined
  proc?.kill()
  await Promise.allSettled([work, proc?.exited])
}

export class LocalTTSError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export async function synthesizeLocalTTS(text: string, voice = DEFAULT_LOCAL_VOICE): Promise<Response> {
  const running = server
  if (!running) throw new LocalTTSError(error ?? "Kitten TTS aún no está listo", 503)
  const id = voice.trim().toLowerCase() || DEFAULT_LOCAL_VOICE
  if (!Object.hasOwn(running.voices, id)) throw new LocalTTSError("Voz de Kitten desconocida", 400)
  const response = await fetch(`http://127.0.0.1:${running.port}/tts`, {
    method: "POST",
    headers: { Authorization: running.token, "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice: id }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new LocalTTSError("No se pudo sintetizar con Kitten", response.status === 400 ? 400 : 503)
  return response
}
