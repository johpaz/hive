#!/usr/bin/env bun

import { existsSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dir, "..")
const required = [
  "dist/hive.js",
  "dist/tool-worker.js",
  "dist/hive.cmd",
  "dist/hive.ps1",
  "dist/ui/index.html",
]

for (const path of required) {
  if (!existsSync(resolve(root, path))) throw new Error(`Missing package artifact: ${path}`)
}

if (existsSync(resolve(root, "dist/ui/dist/index.html"))) {
  throw new Error("UI was copied twice: dist/ui/dist/index.html must not exist")
}

const pkg = await Bun.file(resolve(root, "package.json")).json()
if (!pkg.dependencies?.["@johpaz/hive-db"]) {
  throw new Error("package.json must declare @johpaz/hive-db as a runtime dependency")
}

const cli = await Bun.file(resolve(root, "dist/hive.js")).text()
if (cli.includes('require2("../native.cjs")') || cli.includes('require("../native.cjs")')) {
  throw new Error("dist/hive.js contains a broken relative native.cjs import")
}
if (!cli.includes("@johpaz/hive-db")) {
  throw new Error("dist/hive.js must keep @johpaz/hive-db external")
}
if (cli.includes('"/favicon.ico"')) {
  throw new Error("dist/hive.js contains embedded UI; npm must ship UI only in dist/ui")
}

const worker = await Bun.file(resolve(root, "dist/tool-worker.js")).text()
for (const forbidden of ["../native.cjs", "@johpaz/hive-db", "JsHiveDb"]) {
  if (worker.includes(forbidden)) throw new Error(`tool-worker.js contains ${forbidden}`)
}

console.log("Package artifacts verified")
