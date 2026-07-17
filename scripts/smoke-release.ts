#!/usr/bin/env bun

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const argv = process.argv.slice(2)
const value = (name: string) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}
const executable = value("--executable")
const expectedVersion = value("--version")
const uiDir = value("--ui-dir")
if (!executable || !expectedVersion) {
  throw new Error("Usage: bun scripts/smoke-release.ts --executable <path> --version <version> [--ui-dir <path>] [--port <port>]")
}

const command = resolve(executable)
const versionRun = Bun.spawnSync([command, "--version"], { stdout: "pipe", stderr: "pipe" })
const versionOutput = versionRun.stdout.toString().trim()
if (versionRun.exitCode !== 0 || versionOutput !== `Hive v${expectedVersion}`) {
  throw new Error(`Version smoke failed: exit=${versionRun.exitCode}, stdout=${versionOutput}, stderr=${versionRun.stderr.toString()}`)
}

const hiveHome = mkdtempSync(join(tmpdir(), "hive-release-smoke-"))
const port = Number(value("--port") ?? "28790")
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error(`Invalid smoke port: ${port}`)
}
const child = Bun.spawn([command, "start", "--skip-check"], {
  stdout: "pipe",
  stderr: "pipe",
  env: {
    ...process.env,
    HIVE_HOME: hiveHome,
    HIVE_DB_PATH: join(hiveHome, "hivedb"),
    HIVE_HOST: "127.0.0.1",
    HIVE_PORT: String(port),
    HIVE_GATEWAY_CHILD: "1",
    NO_BROWSER: "1",
    ...(uiDir ? { HIVE_UI_DIR: resolve(uiDir) } : {}),
  },
})

try {
  const deadline = Date.now() + 45_000
  let ready = false
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000) })
      // The gateway binds the port and answers /health with 200 {"status":"starting"}
      // before the real router is installed via server.reload() — every other route
      // 503s during that window. Wait for the real handler's {"status":"ok"} body,
      // not just an HTTP-level 200, or the next fetch below can hit the placeholder.
      if (health.ok && (await health.json())?.status === "ok") {
        ready = true
        break
      }
    } catch {}
    await Bun.sleep(300)
  }

  if (!ready) {
    child.kill()
    throw new Error(`Gateway health smoke failed\nstdout: ${await new Response(child.stdout).text()}\nstderr: ${await new Response(child.stderr).text()}`)
  }

  const ui = await fetch(`http://127.0.0.1:${port}/`)
  const html = await ui.text()
  if (!ui.ok || !html.includes('<div id="root">')) {
    throw new Error(`UI smoke failed: status=${ui.status}`)
  }

  console.log(`Release smoke passed for ${command}`)
} finally {
  child.kill()
  await Promise.race([child.exited, Bun.sleep(3_000)])
  rmSync(hiveHome, { recursive: true, force: true })
}
