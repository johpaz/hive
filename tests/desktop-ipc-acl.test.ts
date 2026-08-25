import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * La ventana de la app de escritorio no carga archivos empaquetados: apunta al
 * gateway en `http://127.0.0.1:<puerto>`. Para Tauri ese origen es REMOTO, y su
 * ACL rechaza todo `invoke` que venga de un origen remoto salvo que la
 * capability lo declare (tauri 2.11.5, `webview/mod.rs`: "This ensures remote
 * content can never reach custom commands unless an explicit `remote`
 * capability has been configured for them").
 *
 * Sin esa declaración la app arranca y se ve entera, pero se queda sin salidas
 * de audio, sin zoom y sin saber si puede autoactualizarse — todo en silencio,
 * porque un `invoke` rechazado sólo devuelve una promesa fallida. Es exactamente
 * lo que pasó: se dio por hecho que era un fallo del selector de sonido.
 */
describe("ACL de la app de escritorio", () => {
  const raiz = join(import.meta.dir, "..", "apps", "hive-desktop", "src-tauri");
  const capability = JSON.parse(
    readFileSync(join(raiz, "capabilities", "default.json"), "utf8"),
  ) as { remote?: { urls?: string[] }; windows?: string[] };
  const main = readFileSync(join(raiz, "src", "main.rs"), "utf8");

  it("declara como remoto el origen del gateway, con comodín de puerto", () => {
    const urls = capability.remote?.urls ?? [];
    expect(urls).toContain("http://127.0.0.1:*");
    // El puerto no es fijo: si el 18790 está ocupado se toma otro libre, así que
    // fijar el puerto en el patrón dejaría la app muda en cuanto cambiara.
    for (const url of urls) expect(url).toMatch(/:\*$/);
  });

  it("la ventana sigue apuntando a un origen http, que es lo que obliga a todo esto", () => {
    expect(main).toContain("WebviewUrl::External");
    expect(main).toMatch(/http:\/\/127\.0\.0\.1:\{port\}/);
  });

  it("cada comando registrado en el handler existe en el archivo", () => {
    const handler = main.match(/generate_handler!\[([^\]]+)\]/);
    expect(handler).not.toBeNull();
    const comandos = handler![1].split(",").map((c) => c.trim()).filter(Boolean);
    expect(comandos.length).toBeGreaterThan(0);
    for (const comando of comandos) {
      expect(main).toMatch(new RegExp(`fn ${comando}\\s*\\(`));
    }
  });
});
