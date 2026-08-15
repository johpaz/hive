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

process.env.HIVE_DB_PATH ||= ":memory:";

// Red de seguridad al cerrar la suite: cualquier archivo que haya dejado un
// worker de tools vivo lo paga el proceso entero. Bun se cayó en CI con
// SIGSEGV al salir con workers sin terminar (workers_spawned 13, terminated 11),
// y el fallo aparece como "los tests fallan" cuando en realidad todos pasaron.
process.on("beforeExit", () => {
  import("../packages/core/src/tool-runtime/index.ts")
    .then((runtime) => runtime.shutdownToolRuntime())
    .catch(() => { /* el módulo nunca se cargó: no hay nada que apagar */ });
});
