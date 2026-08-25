/**
 * computer_use_task — la entrada que llega a la página.
 *
 * Lo que se prueba acá es la diferencia que motivó el cambio: con CDP el
 * navegador genera eventos **de verdad** (`isTrusted === true`), que son los
 * únicos que atienden un canvas, un PDF incrustado o cualquier interfaz que
 * mira ese flag. Los eventos sintéticos de `evaluate()` llegan con
 * `isTrusted === false` y son la razón por la que la tool parecía no hacer nada
 * en esas páginas.
 *
 * Es un test vivo: abre un navegador y se saltea solo donde no hay motor.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { isWebViewSupported } from "../packages/core/src/tools/web/browser-backend.ts";
import { WebViewBackend } from "../packages/core/src/tools/web/webview-backend.ts";
import { clicEnPunto, hoverEnPunto, type Vista } from "../packages/core/src/tools/web/computer-use.ts";

const LIVE = isWebViewSupported();
const page = (html: string) => `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

afterAll(() => {
  (globalThis as { Bun?: { WebView?: { closeAll?: () => void } } }).Bun?.WebView?.closeAll?.();
});

// Un lienzo que anota cada evento que recibe: tipo, coordenadas y si el
// navegador lo considera confiable.
const LIENZO = page(`
  <canvas id="c" width="400" height="300" style="position:absolute;top:0;left:0"></canvas>
  <script>
    window.eventos = [];
    const c = document.getElementById("c");
    for (const tipo of ["mousedown", "mouseup", "click", "mousemove", "dblclick", "contextmenu"]) {
      c.addEventListener(tipo, (e) => {
        window.eventos.push({ tipo: e.type, x: e.clientX, y: e.clientY, confiable: e.isTrusted, boton: e.button });
      });
    }
  </script>
`);

interface EventoAnotado {
  tipo: string;
  x: number;
  y: number;
  confiable: boolean;
  boton: number;
}

describe.skipIf(!LIVE)("entrada del navegador en computer_use_task", () => {
  let backend: WebViewBackend;
  let vista: Vista;

  beforeEach(async () => {
    backend = new WebViewBackend({ persistSession: false });
    vista = backend as unknown as Vista;
    await backend.navigate(LIENZO);
  });

  afterEach(() => {
    backend.close();
  });

  const eventos = () => backend.evaluate<EventoAnotado[]>("window.eventos");

  test("el clic llega como entrada real del navegador, no como MouseEvent sintético", async () => {
    await clicEnPunto(vista, 120, 80, 0, 1);
    const recibidos = await eventos();

    expect(recibidos.map((e) => e.tipo)).toContain("click");
    // Un canvas no tiene elemento interno al que despacharle nada: si esto
    // vuelve a ser false, la tool dejó de servir para lienzos y PDFs.
    expect(recibidos.every((e) => e.confiable)).toBe(true);
    expect(recibidos.at(-1)?.x).toBe(120);
    expect(recibidos.at(-1)?.y).toBe(80);
  });

  test("el doble clic se cuenta como doble clic", async () => {
    await clicEnPunto(vista, 50, 50, 0, 2);
    expect((await eventos()).map((e) => e.tipo)).toContain("dblclick");
  });

  test("el botón derecho abre el menú contextual", async () => {
    await clicEnPunto(vista, 60, 60, 2, 1);
    const recibidos = await eventos();

    expect(recibidos.map((e) => e.tipo)).toContain("contextmenu");
    expect(recibidos.some((e) => e.boton === 2)).toBe(true);
  });

  test("el hover mueve el puntero de verdad, sin hacer clic", async () => {
    await hoverEnPunto(vista, 200, 150);
    const recibidos = await eventos();

    expect(recibidos.some((e) => e.tipo === "mousemove" && e.confiable)).toBe(true);
    expect(recibidos.some((e) => e.tipo === "mousedown")).toBe(false);
  });

  test("un backend que declara cdp pero no lo implementa no se traga el clic", async () => {
    // agent-browser expone `cdp()` y lanza: antes devolvía un objeto con pinta
    // de éxito y la página nunca recibía el clic. La tool tiene que darse
    // cuenta y hacer el clic igual, por el camino sintético.
    const fingeCdp = new Proxy(backend as unknown as Record<string, unknown>, {
      get: (target, prop) =>
        prop === "cdp"
          ? async () => {
              throw new Error("agent-browser no expone CDP crudo");
            }
          : Reflect.get(target, prop),
    }) as unknown as Vista;

    await backend.navigate(page(`<button id="b" style="position:absolute;left:0;top:0;width:200px;height:100px"
      onclick="window.golpeado = true">Enviar</button>`));
    await clicEnPunto(fingeCdp, 50, 30, 0, 1);

    expect(await backend.evaluate<boolean>("window.golpeado")).toBe(true);
  });

  test("sin CDP se cae a los eventos sintéticos en vez de fallar", async () => {
    // El WebKit de macOS no tiene puente CDP: ahí la tool tiene que seguir
    // funcionando sobre HTML normal, aunque los eventos no sean confiables.
    const sinCdp = new Proxy(backend as unknown as Record<string, unknown>, {
      get: (target, prop) => (prop === "cdp" ? undefined : Reflect.get(target, prop)),
    }) as unknown as Vista;

    await backend.navigate(page(`<button id="b" style="position:absolute;left:0;top:0;width:200px;height:100px"
      onclick="window.golpeado = event.isTrusted">Enviar</button>`));
    await clicEnPunto(sinCdp, 50, 30, 0, 1);

    expect(await backend.evaluate<boolean>("window.golpeado")).toBe(false);
  });
});
