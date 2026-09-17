/**
 * La suite no puede escribir en la carpeta real del usuario. El logger (logs/) y
 * el almacén de artifacts (artifacts/) resuelven getHiveDir(); sin un HIVE_HOME
 * aislado en el preload, cada corrida dejaba en ~/.hive un log de ~1 MB e
 * imágenes de prueba.
 */

import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { getHiveDir } from "../packages/core/src/config/loader";

describe("aislamiento de la suite", () => {
  test("getHiveDir() no apunta a ~/.hive ni a ~/.hive-dev", () => {
    expect(getHiveDir().startsWith(join(homedir(), ".hive"))).toBe(false);
  });
});
