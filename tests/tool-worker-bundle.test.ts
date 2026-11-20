import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buscarArtifactEnDisco } from "../packages/core/src/tools/office/resolve-input";

/**
 * El worker de herramientas no puede contener el binding nativo de HiveDB:
 * scripts/build-gateway.ts rechaza el build de la app de escritorio y del paquete si
 * aparece. Una tool de office que importe la base de datos (como pasó con el
 * ayudante de artifact_id) lo rompía sin que ningún test lo notara.
 */
describe("bundle del tool worker", () => {
  test("no arrastra dependencias nativas de HiveDB", async () => {
    const result = await Bun.build({
      entrypoints: [join(import.meta.dir, "..", "packages", "core", "src", "tool-runtime", "tool-worker.ts")],
      target: "bun",
    });
    expect(result.success).toBe(true);
    const fuente = await result.outputs[0].text();
    for (const prohibido of ["../native.cjs", "@johpaz/hive-db", "JsHiveDb"]) {
      expect(fuente.includes(prohibido), `el worker contiene ${prohibido}`).toBe(false);
    }
  }, 60_000);
});

describe("buscarArtifactEnDisco", () => {
  const id = "0a1b2c3d-1111-4222-8333-444455556666";

  test("encuentra el archivo por su id sin consultar la base de datos", () => {
    const raiz = mkdtempSync(join(tmpdir(), "art-"));
    mkdirSync(join(raiz, "2026-11-20"), { recursive: true });
    writeFileSync(join(raiz, "2026-11-20", `${id}.xlsx`), "x");
    expect(buscarArtifactEnDisco(id, raiz)).toBe(join(raiz, "2026-11-20", `${id}.xlsx`));
  });

  test("un id que no es UUID nunca se usa para armar una ruta", () => {
    const raiz = mkdtempSync(join(tmpdir(), "art-"));
    expect(buscarArtifactEnDisco("../../etc/passwd", raiz)).toBeNull();
    expect(buscarArtifactEnDisco("*", raiz)).toBeNull();
  });

  test("devuelve null si no existe", () => {
    expect(buscarArtifactEnDisco(id, mkdtempSync(join(tmpdir(), "art-")))).toBeNull();
  });
});
