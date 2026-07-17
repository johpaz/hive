#!/usr/bin/env bun

import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { resolve } from "node:path"

const prebuiltUi = process.argv.includes("--prebuilt-ui")
const root = resolve(import.meta.dir, "..")
const dist = resolve(root, "dist")
const uiDist = resolve(root, "packages/hive-ui/dist")

async function run(command: string[], cwd = root): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`)
}

await run(["bun", "packages/skills/scripts/generate-bundle.ts"])
if (!prebuiltUi) await run(["bun", "run", "build"], resolve(root, "packages/hive-ui"))

if (!existsSync(resolve(uiDist, "index.html"))) {
  throw new Error(`Prebuilt UI is missing: ${resolve(uiDist, "index.html")}`)
}

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

// npm ships dist/ui as regular package files. Replace the generated embedded
// bundle while bundling the CLI so those assets are not duplicated inside
// dist/hive.js (standalone executables use the real generated module).
const externalUiPlugin: Bun.BunPlugin = {
  name: "external-ui-for-npm",
  setup(build) {
    build.onResolve({ filter: /ui-bundle\.generated$/ }, () => ({
      path: "ui-bundle.generated",
      namespace: "external-ui",
    }))
    build.onLoad({ filter: /.*/, namespace: "external-ui" }, () => ({
      contents: "export const embeddedUI = new Map();",
      loader: "ts",
    }))
  },
}

const cli = await Bun.build({
  entrypoints: [resolve(root, "packages/cli/src/index.ts")],
  target: "bun",
  external: ["@johpaz/hive-db"],
  plugins: [externalUiPlugin],
  outdir: dist,
  naming: "hive.js",
})
if (!cli.success) throw new AggregateError(cli.logs, "Failed to bundle dist/hive.js")

const worker = await Bun.build({
  entrypoints: [resolve(root, "packages/core/src/tool-runtime/tool-worker.ts")],
  target: "bun",
  outdir: dist,
  naming: "tool-worker.js",
})
if (!worker.success) throw new AggregateError(worker.logs, "Failed to bundle dist/tool-worker.js")

const workerSource = await Bun.file(resolve(dist, "tool-worker.js")).text()
for (const forbidden of ["../native.cjs", "@johpaz/hive-db", "JsHiveDb"]) {
  if (workerSource.includes(forbidden)) {
    throw new Error(`tool-worker.js unexpectedly contains native dependency: ${forbidden}`)
  }
}

cpSync(uiDist, resolve(dist, "ui"), { recursive: true })
await run(["bun", "packages/cli/scripts/postbuild.ts"])
chmodSync(resolve(dist, "hive.js"), 0o755)

console.log(`npm package artifacts ready in ${dist}`)
