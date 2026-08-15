// Auto-generado — NO EDITAR.
//
// Lo que se commitea es SIEMPRE este stub. `scripts/build-gateway.ts` lo
// reescribe justo antes de compilar el binario standalone con:
//
//   import workerFile from "./tool-worker.generated.js" with { type: "file" }
//   export const embeddedToolWorkerPath: string | null = workerFile
//
// y lo restaura al terminar. Ese `with { type: "file" }` es lo que hace que
// `bun build --compile` meta el bundle del tool worker dentro del ejecutable
// (queda en /$bunfs/root/...), porque `new Worker(new URL("./tool-worker.ts",
// import.meta.url))` NO se embebe solo: el path se resuelve en runtime y el
// bundler no lo ve. Sin esto, la app de escritorio se instala sin worker y
// cualquier turno con más de una tool call moría con "Tool worker entry not
// found" (v1.0.3 y anteriores).
//
// En dev y en el paquete npm este valor es null y no hace falta: el worker se
// resuelve desde disco (tool-worker.ts al lado de este archivo, o
// dist/tool-worker.js junto al bundle).
export const embeddedToolWorkerPath: string | null = null
