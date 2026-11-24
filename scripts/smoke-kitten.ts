import assert from "node:assert/strict"
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import pkg from "../package.json"
import { detectKittenPackage } from "../packages/core/src/gateway/tts/src/detect"

const archive = resolve(process.argv[2] ?? "")
const upstream = process.argv.includes("--upstream")
const target = detectKittenPackage(pkg.version)
assert(target)
assert.equal(basename(archive), target.filename)
const root = await mkdtemp(join(tmpdir(), "hive-kitten-smoke-"))
process.env.HIVE_TTS_ROOT = root
const { getLocalTTSStatus, startLocalTTS, stopLocalTTS } = await import("../packages/core/src/gateway/tts/kitten")
const { handleSpeakLocalTTS } = await import("../packages/core/src/gateway/routes/tts-local")

async function waitFor(phase: "ready" | "error") {
  const deadline = Date.now() + (upstream ? 420_000 : 120_000)
  while (Date.now() < deadline) {
    const status = getLocalTTSStatus()
    if (status.phase === phase) {
      // Give the startup task time to release its single-flight slot.
      await Bun.sleep(10)
      return status
    }
    if (status.phase === "error") throw new Error(status.error)
    await Bun.sleep(100)
  }
  throw new Error(`Timed out waiting for Kitten (${phase})`)
}

const speak = (body: object) => handleSpeakLocalTTS(new Request("http://localhost/api/tts-local/speak", {
  method: "POST", body: JSON.stringify(body),
}), response => response)

const realFetch = globalThis.fetch
const downloads: string[] = []
const expectedDownloads = [target.checksumUrl, upstream ? target.uv.url : target.url]
globalThis.fetch = (async (input, options) => {
  if (input === target.checksumUrl || input === target.url) {
    downloads.push(input)
    if (upstream) return new Response(null, { status: 404 })
    return new Response(Bun.file(input === target.checksumUrl ? `${archive}.sha256` : archive))
  }
  if (input === target.uv.url) downloads.push(input)
  return realFetch(input, options)
}) as typeof fetch

try {
  const incomplete = join(root, "incomplete.tar.gz")
  await writeFile(incomplete, "incomplete bundle")
  await copyFile(`${archive}.sha256`, `${incomplete}.sha256`)
  process.env.HIVE_KITTEN_ARCHIVE = incomplete
  assert.equal(getLocalTTSStatus().installed, false)
  assert.equal(startLocalTTS(), true)
  assert.equal(startLocalTTS(), false)
  assert.equal((await speak({ text: "Hola" })).status, 503)
  assert.match((await waitFor("error")).error ?? "", /Checksum/)
  assert.equal(getLocalTTSStatus().installed, false)

  delete process.env.HIVE_KITTEN_ARCHIVE
  assert.equal(startLocalTTS(), true)
  const ready = await waitFor("ready")
  assert.equal(ready.installed, true)
  assert.deepEqual(downloads, expectedDownloads)
  assert(ready.voices.some(voice => voice.id === "lucia"))
  const response = await speak({ text: "Hola, soy Hive. ¿En qué te puedo ayudar?" })
  const audio = Buffer.from(await response.arrayBuffer())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "audio/wav")
  assert.equal(audio.toString("ascii", 0, 4), "RIFF")
  assert.equal(audio.readUInt32LE(24), 24000)
  assert(audio.length > 44)
  assert.equal((await speak({ text: "Hola", voice: "unknown" })).status, 400)
  await stopLocalTTS()

  assert.equal(startLocalTTS(), true)
  await waitFor("ready")
  assert.equal((await speak({ text: "Hola", voice: "diego" })).status, 200)
  assert.deepEqual(downloads, expectedDownloads)
  console.log(`Kitten ${upstream ? "upstream" : "release"} installation, retry, offline restart and WAV synthesis passed`)
} finally {
  globalThis.fetch = realFetch
  await stopLocalTTS()
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
