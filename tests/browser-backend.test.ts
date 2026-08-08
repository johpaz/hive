/**
 * BrowserBackend — selección de backend y el WebViewBackend real.
 *
 * Los tests marcados como "vivos" abren un navegador de verdad y se saltan solos
 * donde no hay motor (sin Chrome y sin macOS). Los de selección son puros y
 * corren siempre: son los que evitan que un cambio de default mande el gateway
 * headless a un backend que necesita display.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import {
  resolveBackendKind,
  isWebViewSupported,
  resolveWebViewEngine,
  findChrome,
} from "../packages/core/src/tools/web/browser-backend.ts";
import { WebViewBackend } from "../packages/core/src/tools/web/webview-backend.ts";

const ORIGINAL_ENV = process.env.HIVE_BROWSER_BACKEND;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.HIVE_BROWSER_BACKEND;
  else process.env.HIVE_BROWSER_BACKEND = ORIGINAL_ENV;
});

// Una sola vez, al final del archivo: `closeAll()` mata TODOS los subprocesos de
// navegador del proceso, así que dentro de un `afterAll` por bloque le arranca
// Chrome de abajo al bloque siguiente ("Chrome killed by signal 9").
afterAll(() => {
  (globalThis as { Bun?: { WebView?: { closeAll?: () => void } } }).Bun?.WebView?.closeAll?.();
});

// ─── selección de backend ─────────────────────────────────────────────────────

describe("resolveBackendKind", () => {
  test("el default es agent-browser — es el único que corre headless sin Chrome", () => {
    delete process.env.HIVE_BROWSER_BACKEND;
    expect(resolveBackendKind(undefined)).toBe("agent-browser");
  });

  test("respeta la preferencia de config", () => {
    delete process.env.HIVE_BROWSER_BACKEND;
    expect(resolveBackendKind("webview")).toBe("webview");
    expect(resolveBackendKind("agent-browser")).toBe("agent-browser");
  });

  test("HIVE_BROWSER_BACKEND pisa la config", () => {
    process.env.HIVE_BROWSER_BACKEND = "webview";
    expect(resolveBackendKind("agent-browser")).toBe("webview");

    process.env.HIVE_BROWSER_BACKEND = "agent-browser";
    expect(resolveBackendKind("webview")).toBe("agent-browser");
  });

  test("'auto' nunca elige webview si no hay motor disponible", () => {
    delete process.env.HIVE_BROWSER_BACKEND;
    const kind = resolveBackendKind("auto");
    expect(kind).toBe(isWebViewSupported() ? "webview" : "agent-browser");
  });

  test("un valor desconocido cae al default en vez de romper", () => {
    process.env.HIVE_BROWSER_BACKEND = "netscape";
    expect(resolveBackendKind("webview")).toBe("agent-browser");
  });
});

describe("detección de motor", () => {
  test("resolveWebViewEngine devuelve webkit en macOS y chrome sólo si hay binario", () => {
    const engine = resolveWebViewEngine();
    if (process.platform === "darwin") {
      expect(engine).toBe("webkit");
    } else {
      expect(engine).toBe(findChrome() ? "chrome" : null);
    }
  });

  test("BUN_CHROME_PATH gana sobre la búsqueda en rutas estándar", () => {
    const previous = process.env.BUN_CHROME_PATH;
    process.env.BUN_CHROME_PATH = "/ruta/propia/chrome";
    try {
      expect(findChrome()).toBe("/ruta/propia/chrome");
    } finally {
      if (previous === undefined) delete process.env.BUN_CHROME_PATH;
      else process.env.BUN_CHROME_PATH = previous;
    }
  });
});

// ─── WebViewBackend vivo ──────────────────────────────────────────────────────

const LIVE = isWebViewSupported();
// El charset va explícito: sin él el motor asume latin-1 y "botón" llega como
// "botÃ³n". Una página real lo declara; una data: URL no.
const page = (html: string) => `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

describe.skipIf(!LIVE)("WebViewBackend (navegador real)", () => {
  let backend: WebViewBackend;

  beforeEach(() => {
    backend = new WebViewBackend();
  });

  afterEach(() => {
    backend.close();
  });

  test("navega y evalúa en la página", async () => {
    await backend.navigate(page("<h1>hola mundo</h1>"));
    expect(await backend.evaluate<string>("document.querySelector('h1').textContent")).toBe("hola mundo");
  }, 15000);

  test("serializa operaciones concurrentes — WebView rechaza las solapadas", async () => {
    // Sin la cola interna esto falla con
    // "ERR_INVALID_STATE: a simple operation is already pending".
    await backend.navigate(page("<p id=x>1</p>"));

    const results = await Promise.all([
      backend.evaluate("1 + 1"),
      backend.evaluate("2 + 2"),
      backend.evaluate("3 + 3"),
      backend.evaluate("document.getElementById('x').textContent"),
    ]);

    expect(results).toEqual([2, 4, 6, "1"]);
  }, 15000);

  test("una operación fallida no rompe la cola para las siguientes", async () => {
    await backend.navigate(page("<h1>sigo viva</h1>"));

    await expect(backend.evaluate("esto.no.existe()")).rejects.toThrow();
    expect(await backend.evaluate<string>("document.querySelector('h1').textContent")).toBe("sigo viva");
  }, 15000);

  test("click y fill operan por selector CSS", async () => {
    await backend.navigate(
      page(`<input id="i"><button id="b" onclick="document.getElementById('i').dataset.hit='1'">Go</button>`),
    );

    await backend.fill("#i", "texto nuevo");
    expect(await backend.evaluate<string>("document.getElementById('i').value")).toBe("texto nuevo");

    await backend.click("#b");
    expect(await backend.evaluate<string>("document.getElementById('i').dataset.hit")).toBe("1");
  }, 15000);

  test("fill reemplaza el contenido en vez de agregarlo", async () => {
    await backend.navigate(page(`<input id="i" value="viejo">`));
    await backend.fill("#i", "nuevo");
    expect(await backend.evaluate<string>("document.getElementById('i').value")).toBe("nuevo");
  }, 15000);

  test("typeIn y fill fallan claro cuando el selector no existe", async () => {
    await backend.navigate(page("<h1>x</h1>"));
    await expect(backend.typeIn("#no-existe", "x")).rejects.toThrow(/no encontrado/);
    await expect(backend.fill("#no-existe", "x")).rejects.toThrow(/no encontrado/);
  }, 15000);

  test("la navegación hacia atrás usa goBack — los tipos de bun-types dicen back()", async () => {
    await backend.navigate(page("<h1>primera</h1>"));
    await backend.navigate(page("<h1>segunda</h1>"));
    expect(await backend.evaluate<string>("document.querySelector('h1').textContent")).toBe("segunda");

    await backend.back();
    expect(await backend.evaluate<string>("document.querySelector('h1').textContent")).toBe("primera");
  }, 15000);

  test("screenshot devuelve un PNG en base64", async () => {
    await backend.navigate(page("<h1>foto</h1>"));
    const shot = await backend.screenshot();
    expect(shot.length).toBeGreaterThan(100);
    // Cabecera PNG (\x89PNG) en base64.
    expect(shot.startsWith("iVBORw0KGgo")).toBe(true);
  }, 15000);

  test("screenshotElement recorta al elemento pedido", async () => {
    await backend.navigate(
      page(`<div id="chico" style="width:80px;height:40px;background:red"></div>`),
    );
    const shot = await backend.screenshotElement("#chico");
    expect(shot.startsWith("iVBORw0KGgo")).toBe(true);
    // El recorte tiene que pesar menos que la captura del viewport entero.
    expect(shot.length).toBeLessThan((await backend.screenshot()).length);
  }, 15000);

  test("screenshotElement falla claro si el elemento no existe", async () => {
    await backend.navigate(page("<h1>x</h1>"));
    await expect(backend.screenshotElement("#fantasma")).rejects.toThrow(/no visible o inexistente/);
  }, 15000);
});

// ─── snapshot sintetizado ─────────────────────────────────────────────────────

describe.skipIf(!LIVE)("WebViewBackend.snapshot", () => {
  let backend: WebViewBackend;

  beforeEach(() => {
    backend = new WebViewBackend();
  });

  afterEach(() => {
    backend.close();
  });

  test("reproduce el formato de agent-browser: rol, nombre y ref", async () => {
    await backend.navigate(page(`<h1>Example Domain</h1><p><a href="/x">Learn more</a></p>`));
    const snapshot = await backend.snapshot({ compact: true, depth: 3 });

    expect(snapshot).toContain('- heading "Example Domain" [level=1, ref=e1]');
    expect(snapshot).toContain('link "Learn more"');
    expect(snapshot).toMatch(/ref=e\d+/);
  }, 15000);

  test("anida los hijos bajo el padre que emitió línea", async () => {
    await backend.navigate(page(`<p>Intro <a href="/x">un link</a></p>`));
    const snapshot = await backend.snapshot();

    const linea = snapshot.split("\n").find((l) => l.includes("link"));
    expect(linea?.startsWith("  ")).toBe(true);
  }, 15000);

  test("los divs de maquetado no generan sangría — el árbol no se hunde", async () => {
    await backend.navigate(
      page(`<div><div><div><div><button>Enviar</button></div></div></div></div>`),
    );
    const snapshot = await backend.snapshot({ depth: 3 });

    // Cuatro divs de por medio y el botón sigue en el nivel raíz.
    expect(snapshot).toBe('- button "Enviar" [ref=e1]');
  }, 15000);

  test("ignora script, style y lo oculto", async () => {
    await backend.navigate(
      page(`<script>var secreto=1</script><style>.x{}</style>
            <div hidden><a href="/h">oculto</a></div>
            <div style="display:none"><a href="/d">tampoco</a></div>
            <div aria-hidden="true"><a href="/a">ni este</a></div>
            <a href="/v">visible</a>`),
    );
    const snapshot = await backend.snapshot();

    expect(snapshot).toContain("visible");
    expect(snapshot).not.toContain("secreto");
    expect(snapshot).not.toContain("oculto");
    expect(snapshot).not.toContain("tampoco");
    expect(snapshot).not.toContain("ni este");
  }, 15000);

  test("toma el nombre accesible de aria-label, alt y placeholder", async () => {
    await backend.navigate(
      page(`<button aria-label="Cerrar ventana"></button>
            <img src="x.png" alt="Un gato">
            <input placeholder="Tu correo">`),
    );
    const snapshot = await backend.snapshot();

    expect(snapshot).toContain("Cerrar ventana");
    expect(snapshot).toContain("Un gato");
    expect(snapshot).toContain("Tu correo");
  }, 15000);

  test("interactiveOnly deja sólo lo accionable", async () => {
    await backend.navigate(
      page(`<h1>Un título</h1><p>Un párrafo largo</p><a href="/x">Un link</a><button>Un botón</button>`),
    );
    const snapshot = await backend.snapshot({ interactiveOnly: true });

    expect(snapshot).toContain("Un link");
    expect(snapshot).toContain("Un botón");
    expect(snapshot).not.toContain("Un título");
    expect(snapshot).not.toContain("Un párrafo largo");
  }, 15000);

  test("depth corta la profundidad de lo que sí anida", async () => {
    // La profundidad cuenta niveles *emitidos*, no nodos del DOM: por eso hace
    // falta un ancestro con nombre propio (el nav) para que el link baje un nivel.
    await backend.navigate(page(`<nav aria-label="Menú"><a href="/x">hondo</a></nav>`));

    expect(await backend.snapshot({ depth: 1 })).not.toContain("hondo");
    expect(await backend.snapshot({ depth: 5 })).toContain("hondo");
  }, 15000);

  test("marca los atributos de estado del control", async () => {
    await backend.navigate(
      page(`<input type="checkbox" aria-label="Acepto" checked>
            <button disabled aria-label="Enviar">x</button>`),
    );
    const snapshot = await backend.snapshot();

    expect(snapshot).toContain("checked");
    expect(snapshot).toContain("disabled");
  }, 15000);

  test("un DOM enorme se trunca en vez de comerse el contexto", async () => {
    const filas = Array.from({ length: 4000 }, (_, i) => `<p>fila número ${i} con texto de relleno</p>`).join("");
    await backend.navigate(page(`<div>${filas}</div>`));

    const snapshot = await backend.snapshot();
    expect(snapshot.length).toBeLessThan(21_000);
    expect(snapshot).toContain("snapshot truncado");
  }, 15000);

  test("una página vacía devuelve string vacío, no una excepción", async () => {
    await backend.navigate(page("<body></body>"));
    expect(await backend.snapshot()).toBe("");
  }, 15000);
});
