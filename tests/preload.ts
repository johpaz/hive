/**
 * Preload de la suite de tests.
 *
 * Cada archivo de test pone `process.env.HIVE_DB_PATH = ":memory:"` en su primera
 * línea, pero los `import` de ESM se evalúan ANTES que cualquier sentencia del
 * módulo: si algo de la cadena de imports resuelve la ruta de la BD al cargarse,
 * la asignación llega tarde y la suite termina abriendo la base real del usuario
 * (~/.hive/data/hivedb), escribiéndole contadores y filtrando estado entre
 * archivos. Un preload corre antes que todo, así que acá sí gana.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HIVE_DB_PATH ||= ":memory:";

// Lo mismo con la carpeta de hive: el logger (logs/) y los artifacts
// (artifacts/) resuelven getHiveDir(), y sin esto cada corrida le dejaba al
// usuario en ~/.hive un log de ~1 MB e imágenes de prueba.
if (!process.env.HIVE_HOME) {
  const testHome = mkdtempSync(join(tmpdir(), "hive-test-home-"));
  process.env.HIVE_HOME = testHome;
  process.on("exit", () => rmSync(testHome, { recursive: true, force: true }));
}

// Red de seguridad al cerrar la suite: cualquier archivo que haya dejado un
// worker de tools vivo lo paga el proceso entero. Bun se cayó en CI con
// SIGSEGV al salir con workers sin terminar (workers_spawned 13, terminated 11),
// y el fallo aparece como "los tests fallan" cuando en realidad todos pasaron.
process.on("beforeExit", () => {
  import("../packages/core/src/tool-runtime/index.ts")
    .then((runtime) => runtime.shutdownToolRuntime())
    .catch(() => { /* el módulo nunca se cargó: no hay nada que apagar */ });
});
