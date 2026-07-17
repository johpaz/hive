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
  let health: Response | undefined
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break
    try {
      health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000) })
      if (health.ok) break
    } catch {}
    await Bun.sleep(300)
  }

  if (!health?.ok) {
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
