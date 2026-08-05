import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveUISource } from "../packages/core/src/gateway/helpers/ui-source";

/** Simula un filesystem con una lista de rutas que existen. */
const fs = (...present: string[]) => (candidate: string) => present.includes(candidate);

describe("resolveUISource", () => {
  const base = {
    hiveDir: "/home/u/.hive",
    cwd: "/repo",
    exists: fs(),
  };

  it("HIVE_UI_DIR le gana al bundle embebido en el binario", () => {
    // La regresión concreta: la imagen Docker construye la UI en cada build y la
    // deja en /app/ui, pero el binario llevaba embebida una copia commiteada el
    // 2026-07-03. Como el embed se consultaba primero, el contenedor servía esa
    // UI vieja y /app/ui quedaba inerte.
    const source = resolveUISource({
      ...base,
      uiDirEnv: "/app/ui",
      hasEmbedded: true,
      exists: fs("/app/ui/index.html"),
    });
    expect(source).toEqual({ kind: "disk", dir: "/app/ui" });
  });

  it("usa el embebido cuando no hay ningún index.html en disco", () => {
    // Es el caso del ejecutable standalone: no hay dist en ningún lado y la UI
    // sólo existe dentro del binario.
    expect(resolveUISource({ ...base, hasEmbedded: true })).toEqual({ kind: "embedded" });
  });

  it("cae al embebido si HIVE_UI_DIR apunta a un directorio sin index.html", () => {
    const source = resolveUISource({
      ...base,
      uiDirEnv: "/app/ui",
      hasEmbedded: true,
      exists: fs("/app/ui"),
    });
    expect(source).toEqual({ kind: "embedded" });
  });

  it("el embebido le gana a un ~/.hive/ui heredado de una instalación vieja", () => {
    // El embed va compilado dentro del ejecutable, así que siempre corresponde
    // a su versión; un directorio suelto en el home puede ser de hace meses.
    const source = resolveUISource({
      ...base,
      hasEmbedded: true,
      exists: fs("/home/u/.hive/ui/index.html", "/repo/packages/hive-ui/dist/index.html"),
    });
    expect(source).toEqual({ kind: "embedded" });
  });

  it("respeta la precedencia HIVE_UI_DIR > ~/.hive/ui > HIVE_DIST_DIR/ui > monorepo", () => {
    const all = fs(
      "/app/ui/index.html",
      "/home/u/.hive/ui/index.html",
      "/opt/dist/ui/index.html",
      "/repo/packages/hive-ui/dist/index.html",
    );
    expect(resolveUISource({ ...base, distDirEnv: "/opt/dist", uiDirEnv: "/app/ui", hasEmbedded: false, exists: all }))
      .toEqual({ kind: "disk", dir: "/app/ui" });
    expect(resolveUISource({ ...base, distDirEnv: "/opt/dist", hasEmbedded: false, exists: all }))
      .toEqual({ kind: "disk", dir: "/home/u/.hive/ui" });
    expect(resolveUISource({
      ...base,
      distDirEnv: "/opt/dist",
      hasEmbedded: false,
      exists: fs("/opt/dist/ui/index.html", "/repo/packages/hive-ui/dist/index.html"),
    })).toEqual({ kind: "disk", dir: "/opt/dist/ui" });
    expect(resolveUISource({
      ...base,
      hasEmbedded: false,
      exists: fs("/repo/packages/hive-ui/dist/index.html"),
    })).toEqual({ kind: "disk", dir: "/repo/packages/hive-ui/dist" });
  });

  it("ignora HIVE_DIST_DIR cuando no está definido", () => {
    const source = resolveUISource({
      ...base,
      hasEmbedded: false,
      exists: fs("/repo/packages/hive-ui/dist/index.html"),
    });
    expect(source).toEqual({ kind: "disk", dir: "/repo/packages/hive-ui/dist" });
  });

  it("sin UI en ningún lado devuelve el candidato preferido para el mensaje de error", () => {
    expect(resolveUISource({ ...base, uiDirEnv: "/app/ui", hasEmbedded: false }))
      .toEqual({ kind: "none", dir: "/app/ui" });
    expect(resolveUISource({ ...base, hasEmbedded: false }))
      .toEqual({ kind: "none", dir: "/home/u/.hive/ui" });
  });
});

describe("bundle de UI embebida", () => {
  it("se commitea vacío", () => {
    // generate-ui-bundle.ts reescribe este archivo con la UI en base64 antes de
    // compilar un binario. Commitearlo así hace que la imagen Docker lo embeba
    // y sirva esa copia congelada. Ya pasó: una versión de 2.99 MB estuvo
    // commiteada un mes. El mismo chequeo corre en CI (job "guard").
    const src = readFileSync(
      new URL("../packages/cli/src/ui-bundle.generated.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toContain("Buffer.from(");
  });
});
