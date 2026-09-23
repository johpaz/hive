/**
 * La sesión del navegador sobrevive al proceso.
 *
 * Esto es lo que agent-browser hacía con sus sesiones con nombre y el WebView no
 * puede hacer solo: el perfil de Chrome que abre Bun vive en
 * `/tmp/.<hash>.bun-chrome` con un hash que cambia de un proceso a otro, y el
 * constructor ignora `userDataDir`. Sin la restauración por CDP, cada reinicio
 * del gateway dejaría al agente deslogueado de todo.
 *
 * El test emula un login como los de verdad —cookie de sesión `HttpOnly`, que
 * `document.cookie` no puede ver ni escribir— y comprueba el resultado en **otro
 * proceso**, que es donde la prueba tiene sentido.
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Almacén propio y descartable: el secreto tiene que viajar entre procesos, así
// que no puede ser una BD en memoria, y no queremos tocar el ~/.hive del usuario.
const HOME_TEST = mkdtempSync(join(tmpdir(), "hive-sesion-"));
process.env.HIVE_HOME = HOME_TEST;
process.env.HIVE_DB_PATH = join(HOME_TEST, "hivedb");

const { isWebViewSupported } = await import("../packages/core/src/tools/web/browser-backend.ts");
const { WebViewBackend } = await import("../packages/core/src/tools/web/webview-backend.ts");
const { clearStoredSession, loadStoredCookies } = await import(
  "../packages/core/src/tools/web/browser-session.ts"
);

const LIVE = isWebViewSupported();
const COOKIE = "sid=secreto-de-sesion-123";

/** Un sitio con login: `/entrar` deja la cookie, `/` dice quién eres. */
function levantarSitio() {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const html = (cuerpo: string) =>
        new Response(`<!doctype html><meta charset="utf-8"><body>${cuerpo}</body>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });

      if (url.pathname === "/entrar") {
        return new Response(`<!doctype html><meta charset="utf-8"><body>sesion iniciada</body>`, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            // HttpOnly: el navegador la manda, pero la página no la ve. Es lo
            // que hace cualquier login serio.
            "set-cookie": `${COOKIE}; Path=/; HttpOnly; SameSite=Lax`,
          },
        });
      }

      const cookies = req.headers.get("cookie") ?? "";
      return html(cookies.includes(COOKIE) ? "autenticado" : "anonimo");
    },
  });
}

describe.skipIf(!LIVE)("sesión persistente entre procesos", () => {
  let sitio: ReturnType<typeof Bun.serve>;
  let base: string;

  beforeAll(() => {
    sitio = levantarSitio();
    base = `http://localhost:${sitio.port}`;
  });

  afterAll(() => {
    sitio?.stop(true);
    rmSync(HOME_TEST, { recursive: true, force: true });
  });

  afterEach(async () => {
    await clearStoredSession();
  });

  /** El segundo proceso: mismo almacén por env, navegador nuevo. */
  async function preguntarEnOtroProceso(
    url: string,
  ): Promise<{ texto?: string; visibles?: string; guardadas?: number; error?: string; log: string }> {
    const proc = Bun.spawn(["bun", "tests/fixtures/browser-session-child.ts", url], {
      env: { ...process.env, HIVE_HOME: HOME_TEST, HIVE_DB_PATH: join(HOME_TEST, "hivedb") },
      stdout: "pipe",
      stderr: "pipe",
    });
    // Las dos salidas se leen a la vez: el hijo escribe en ambas y un pipe sin
    // vaciar lo bloquearía a mitad de camino.
    const [salida, errores] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;

    // El logger del hijo comparte stdout con el resultado, así que se busca la
    // línea marcada y no la última.
    const marcada = salida.split("\n").find((l) => l.startsWith("RESULTADO:"));
    const log = `${salida}${errores}`;
    if (!marcada) return { error: "el proceso hijo no imprimió resultado", log };
    return { ...JSON.parse(marcada.slice("RESULTADO:".length)), log };
  }

  test("un login sobrevive al reinicio: la cookie vuelve en un proceso nuevo", async () => {
    const primerArranque = new WebViewBackend({ persistSession: true });
    try {
      await primerArranque.navigate(`${base}/entrar`);
      expect(await primerArranque.evaluate<string>("document.body.innerText.trim()")).toBe(
        "sesion iniciada",
      );
      await primerArranque.flushSession();
    } finally {
      primerArranque.close();
    }

    // La cookie quedó guardada aunque la página nunca pudo leerla.
    const guardadas = await loadStoredCookies();
    expect(guardadas.some((c) => c.name === "sid" && c.value === "secreto-de-sesion-123")).toBe(true);

    const respuesta = await preguntarEnOtroProceso(`${base}/`);
    // El log del hijo es la única pista cuando esto falla en CI, donde no se
    // puede reproducir a mano: dice si el almacén llegó vacío o si el navegador
    // no tomó las cookies.
    if (respuesta.texto !== "autenticado") {
      console.log(`── proceso hijo (${respuesta.guardadas ?? "?"} cookies en el almacén) ──`);
      console.log(respuesta.log);
    }
    expect(respuesta.error).toBeUndefined();
    expect(respuesta.texto).toBe("autenticado");
    // Sigue siendo HttpOnly del otro lado: se restauró la cookie de verdad, no
    // una copia de juguete que la página pueda leer. (Se mira que `sid` no esté,
    // y no que no haya ninguna cookie: el perfil de Chrome que Bun recicla en
    // /tmp puede traer cookies de localhost de cualquier otro proceso.)
    expect(respuesta.visibles ?? "").not.toContain("sid");
  }, 60_000);

  test("sin sesión guardada, el proceso nuevo entra como anónimo", async () => {
    await clearStoredSession();

    const respuesta = await preguntarEnOtroProceso(`${base}/`);
    if (respuesta.texto !== "anonimo") console.log(respuesta.log);
    expect(respuesta.error).toBeUndefined();
    expect(respuesta.texto).toBe("anonimo");
  }, 60_000);
});
