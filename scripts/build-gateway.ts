#!/usr/bin/env bun

import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

type Args = {
  outfile: string
  target: Bun.Build.CompileTarget
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const outfile = get("--outfile")
  const target = get("--target") as Bun.Build.CompileTarget | undefined
  if (!outfile || !target) {
    throw new Error("Usage: bun scripts/build-gateway.ts --target <bun-target> --outfile <path>")
  }
  return { outfile: resolve(outfile), target }
}

const args = parseArgs(process.argv.slice(2))
mkdirSync(dirname(args.outfile), { recursive: true })
const hiveDbEntry = Bun.resolveSync("@johpaz/hive-db", import.meta.dir)
const hiveDbDir = dirname(hiveDbEntry)

const nativeHiveDbPlugin: Bun.BunPlugin = {
  name: "bundle-hivedb-native-binding",
  setup(build) {
    build.onLoad({ filter: /[\\/]@johpaz[\\/]hive-db[\\/]src[\\/]index\.ts$/ }, async ({ path }) => {
      let source = await Bun.file(path).text()
      const createRequireImport = 'import { createRequire } from "node:module";'
      const createRequireSetup = "const require = createRequire(import.meta.url);"
      const dynamicNativeLoad = 'require("../native.cjs")'

      if (!source.includes(createRequireSetup) || !source.includes(dynamicNativeLoad)) {
        throw new Error(`Unsupported @johpaz/hive-db loader at ${path}`)
      }

      source = source
        .replace(createRequireImport, 'import nativeBinding from "../native.cjs";')
        .replace(createRequireSetup, "")
        .replace(dynamicNativeLoad, "nativeBinding")

      return { contents: source, loader: "ts" }
    })
  },
}

const result = await Bun.build({
  entrypoints: [resolve("packages/cli/src/index.ts")],
  target: "bun",
  plugins: [nativeHiveDbPlugin],
  compile: {
    target: args.target,
    outfile: args.outfile,
  },
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

console.log(`Gateway compiled for ${args.target}: ${args.outfile}`)
console.log(`HiveDB loader patched from: ${hiveDbDir}`)
