#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

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

// ─── Tool worker embebido ─────────────────────────────────────────────────────
// El pool de tools levanta `new Worker(path)` con un path que se resuelve en
// runtime, así que el bundler nunca lo ve y `--compile` no lo incluye solo. Sin
// esto el ejecutable queda sin worker y todo turno con más de una tool call
// muere con "Tool worker entry not found" (así se instalaba la app de escritorio
// hasta v1.0.3; Docker se salvaba porque copia tool-worker.js al lado del
// binario). Se resuelve embebiendo el bundle como asset (`with { type: "file" }`),
// que en el ejecutable queda accesible en /$bunfs/root/ y sirve como entry del
// Worker.
const toolRuntimeDir = resolve(import.meta.dir, "..", "packages", "core", "src", "tool-runtime")
const embeddedModule = join(toolRuntimeDir, "embedded-worker.generated.ts")
const workerBundle = join(toolRuntimeDir, "tool-worker.generated.js")
const embeddedModuleStub = readFileSync(embeddedModule)

const worker = await Bun.build({
  entrypoints: [join(toolRuntimeDir, "tool-worker.ts")],
  target: "bun",
  outdir: toolRuntimeDir,
  naming: "tool-worker.generated.js",
})

if (!worker.success) {
  for (const log of worker.logs) console.error(log)
  process.exit(1)
}

// El worker corre en su propio realm sin acceso a los singletons del proceso:
// si el bundle arrastra el binding nativo de HiveDB, deja de ser neutral de
// plataforma y revienta al cargarse. Mismo chequeo que hacen el paquete npm y
// el workflow de release.
const workerSource = readFileSync(workerBundle, "utf8")
for (const forbidden of ["../native.cjs", "@johpaz/hive-db", "JsHiveDb"]) {
  if (workerSource.includes(forbidden)) {
    rmSync(workerBundle, { force: true })
    throw new Error(`tool-worker.generated.js contiene una dependencia nativa: ${forbidden}`)
  }
}

writeFileSync(
  embeddedModule,
  [
    "// Auto-generado por scripts/build-gateway.ts — NO EDITAR ni commitear.",
    "// El stub del repo se restaura al terminar el build.",
    'import workerFile from "./tool-worker.generated.js" with { type: "file" }',
    "",
    "export const embeddedToolWorkerPath: string | null = workerFile",
    "",
  ].join("\n"),
)

try {
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

  // El embebido es invisible hasta que un turno con dos tool calls lo necesita,
  // y así fue como se publicaron instaladores sin worker durante varias
  // versiones. Confirmar que el asset quedó dentro del ejecutable convierte esa
  // regresión en un build roto en vez de un fallo en runtime del usuario.
  // Bun le agrega .exe a los targets de Windows cuando el outfile no lo trae
  // (build-desktop.ts sí lo pasa; una invocación directa no).
  const produced = existsSync(args.outfile) ? args.outfile : `${args.outfile}.exe`
  const compiled = Buffer.from(await Bun.file(produced).bytes())
  if (compiled.indexOf("tool-worker.generated") === -1) {
    throw new Error(`El ejecutable ${produced} se compiló sin el tool worker embebido`)
  }
} finally {
  // Ambos archivos son artefactos de build: el módulo vuelve a su stub y el
  // bundle del worker (~6 MB) no queda tirado en packages/.
  writeFileSync(embeddedModule, embeddedModuleStub)
  rmSync(workerBundle, { force: true })
}

console.log(`Gateway compiled for ${args.target}: ${args.outfile}`)
console.log(`HiveDB loader patched from: ${hiveDbDir}`)
console.log("Tool worker embedded in the executable")
