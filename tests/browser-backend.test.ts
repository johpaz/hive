/**
 * BrowserBackend — selección de backend y el WebViewBackend real.
 *
 * Los tests marcados como "vivos" abren un navegador de verdad y se saltan solos
 * donde no hay motor (sin Chromium y sin macOS). Los puros corren siempre: son
 * los que cuidan la detección del navegador y que una config vieja no deje al
 * gateway sin browser tools.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import {
  resolveBackendKind,
  isWebViewSupported,
  resolveWebViewEngine,
  findChrome,
  browserInstallHint,
} from "../packages/core/src/tools/web/browser-backend.ts";
import { WebViewBackend } from "../packages/core/src/tools/web/webview-backend.ts";
import {
  clearStoredSession,
  loadStoredCookies,
  normalizeCookies,
  sessionPersistenceEnabled,
} from "../packages/core/src/tools/web/browser-session.ts";

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
  test("siempre resuelve al WebView: es el único backend que queda", () => {
    delete process.env.HIVE_BROWSER_BACKEND;
    expect(resolveBackendKind(undefined)).toBe("webview");
    expect(resolveBackendKind("auto")).toBe("webview");
    expect(resolveBackendKind("webview")).toBe("webview");
  });

  test('una config vieja con "agent-browser" no rompe el arranque', () => {
    // El backend por CLI se retiró. Un `hive.json` que todavía lo pida tiene que
    // arrancar igual —avisando— y no dejar al usuario sin navegador.
    delete process.env.HIVE_BROWSER_BACKEND;
    expect(resolveBackendKind("agent-browser")).toBe("webview");

    process.env.HIVE_BROWSER_BACKEND = "agent-browser";
    expect(resolveBackendKind(undefined)).toBe("webview");
  });

  test("un valor desconocido tampoco rompe", () => {
    process.env.HIVE_BROWSER_BACKEND = "netscape";
    expect(resolveBackendKind("webview")).toBe("webview");
  });
});

describe("detección de motor", () => {
  test("chrome gana sobre webkit cuando hay un Chromium instalado", () => {
    // De CDP dependen el árbol de accesibilidad, la sesión persistente y los
    // clics reales, así que WebKit es el último recurso, no la opción de macOS.
    const engine = resolveWebViewEngine();
    if (findChrome()) {
      expect(engine).toBe("chrome");
    } else {
      expect(engine).toBe(process.platform === "darwin" ? "webkit" : null);
    }
  });

  test("BUN_CHROME_PATH gana sobre la búsqueda en rutas estándar", () => {
    const previous = process.env.BUN_CHROME_PATH;
    process.env.BUN_CHROME_PATH = "/ruta/propia/chrome";
    try {
      expect(findChrome()).toBe("/ruta/propia/chrome");
      expect(resolveWebViewEngine()).toBe("chrome");
    } finally {
      if (previous === undefined) delete process.env.BUN_CHROME_PATH;
      else process.env.BUN_CHROME_PATH = previous;
    }
  });

  test("el hint de instalación habla del sistema donde corre", () => {
    const hint = browserInstallHint();
    expect(hint).toContain("BUN_CHROME_PATH");
    if (process.platform === "linux") expect(hint).toContain("Chromium");
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
  });

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
  });

  test("una operación fallida no rompe la cola para las siguientes", async () => {
    await backend.navigate(page("<h1>sigo viva</h1>"));

    await expect(backend.evaluate("esto.no.existe()")).rejects.toThrow();
    expect(await backend.evaluate<string>("document.querySelector('h1').textContent")).toBe("sigo viva");
  });

  test("click y fill operan por selector CSS", async () => {
    await backend.navigate(
      page(`<input id="i"><button id="b" onclick="document.getElementById('i').dataset.hit='1'">Go</button>`),
    );

    await backend.fill("#i", "texto nuevo");
    expect(await backend.evaluate<string>("document.getElementById('i').value")).toBe("texto nuevo");

    await backend.click("#b");
    expect(await backend.evaluate<string>("document.getElementById('i').dataset.hit")).toBe("1");
  });

  test("fill reemplaza el contenido en vez de agregarlo", async () => {
    await backend.navigate(page(`<input id="i" value="viejo">`));
    await backend.fill("#i", "nuevo");
    expect(await backend.evaluate<string>("document.getElementById('i').value")).toBe("nuevo");
  });

  test("typeIn y fill fallan claro cuando el selector no existe", async () => {
    await backend.navigate(page("<h1>x</h1>"));
    await expect(backend.typeIn("#no-existe", "x")).rejects.toThrow(/no encontrado/);
    await expect(backend.fill("#no-existe", "x")).rejects.toThrow(/no encontrado/);
  });

  test("un click a un selector inexistente falla en vez de colgar el navegador", async () => {
    // `WebView.click()` sobre algo que no está se queda esperando para siempre,
    // y la cola es de una sola vía: sin la guarda previa, ese cuelgue se lleva
    // puesto al navegador entero y las tools siguientes nunca responden.
    await backend.navigate(page("<h1>sin botones</h1>"));

    await expect(backend.click("#no-existe")).rejects.toThrow(/no encontrado/);
    // Y lo que viene después sigue funcionando, que es la mitad importante.
    expect(await backend.evaluate<string>("document.querySelector('h1').textContent")).toBe("sin botones");
  });

  test("acepta los nombres de tecla de siempre, no sólo los del motor", async () => {
    // El motor sólo entiende "Enter" y lanza con "Return", que es lo que
    // escriben los modelos y el código viejo.
    await backend.navigate(
      page(`<form onsubmit="document.title='enviado'; return false"><input id="i"></form>`),
    );
    await backend.typeIn("#i", "hola");
    await backend.press("Return");

    expect(await backend.evaluate<string>("document.title")).toBe("enviado");
  });

  test("la navegación hacia atrás va por el historial de CDP", async () => {
    await backend.navigate(page("<h1>primera</h1>"));
    await backend.navigate(page("<h1>segunda</h1>"));
    expect(await backend.evaluate<string>("document.querySelector('h1').textContent")).toBe("segunda");

    await backend.back();
    expect(await backend.evaluate<string>("document.querySelector('h1').textContent")).toBe("primera");
  });

  test("screenshot devuelve un PNG en base64", async () => {
    await backend.navigate(page("<h1>foto</h1>"));
    const shot = await backend.screenshot();
    expect(shot.length).toBeGreaterThan(100);
    // Cabecera PNG (\x89PNG) en base64.
    expect(shot.startsWith("iVBORw0KGgo")).toBe(true);
  });

  test("screenshotElement recorta al elemento pedido", async () => {
    await backend.navigate(
      page(`<div id="chico" style="width:80px;height:40px;background:red"></div>`),
    );
    const shot = await backend.screenshotElement("#chico");
    expect(shot.startsWith("iVBORw0KGgo")).toBe(true);
    // El recorte tiene que pesar menos que la captura del viewport entero.
    expect(shot.length).toBeLessThan((await backend.screenshot()).length);
  });

  test("screenshotElement falla claro si el elemento no existe", async () => {
    await backend.navigate(page("<h1>x</h1>"));
    await expect(backend.screenshotElement("#fantasma")).rejects.toThrow(/no visible o inexistente/);
  });
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
  });

  test("anida los hijos bajo el padre que emitió línea", async () => {
    await backend.navigate(page(`<p>Intro <a href="/x">un link</a></p>`));
    const snapshot = await backend.snapshot();

    const linea = snapshot.split("\n").find((l) => l.includes("link"));
    expect(linea?.startsWith("  ")).toBe(true);
  });

  test("los divs de maquetado no generan sangría — el árbol no se hunde", async () => {
    await backend.navigate(
      page(`<div><div><div><div><button>Enviar</button></div></div></div></div>`),
    );
    const snapshot = await backend.snapshot({ depth: 3 });

    // Cuatro divs de por medio y el botón sigue en el nivel raíz.
    expect(snapshot).toBe('- button "Enviar" [ref=e1]');
  });

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
  });

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
  });

  test("interactiveOnly deja sólo lo accionable", async () => {
    await backend.navigate(
      page(`<h1>Un título</h1><p>Un párrafo largo</p><a href="/x">Un link</a><button>Un botón</button>`),
    );
    const snapshot = await backend.snapshot({ interactiveOnly: true });

    expect(snapshot).toContain("Un link");
    expect(snapshot).toContain("Un botón");
    expect(snapshot).not.toContain("Un título");
    expect(snapshot).not.toContain("Un párrafo largo");
  });

  test("depth corta la profundidad de lo que sí anida", async () => {
    // La profundidad cuenta niveles *emitidos*, no nodos del DOM: por eso hace
    // falta un ancestro con nombre propio (el nav) para que el link baje un nivel.
    await backend.navigate(page(`<nav aria-label="Menú"><a href="/x">hondo</a></nav>`));

    expect(await backend.snapshot({ depth: 1 })).not.toContain("hondo");
    expect(await backend.snapshot({ depth: 5 })).toContain("hondo");
  });

  test("marca los atributos de estado del control", async () => {
    await backend.navigate(
      page(`<input type="checkbox" aria-label="Acepto" checked>
            <button disabled aria-label="Enviar">x</button>`),
    );
    const snapshot = await backend.snapshot();

    expect(snapshot).toContain("checked");
    expect(snapshot).toContain("disabled");
  });

  test("un DOM enorme se trunca en vez de comerse el contexto", async () => {
    const filas = Array.from({ length: 4000 }, (_, i) => `<p>fila número ${i} con texto de relleno</p>`).join("");
    await backend.navigate(page(`<div>${filas}</div>`));

    const snapshot = await backend.snapshot();
    expect(snapshot.length).toBeLessThan(21_000);
    expect(snapshot).toContain("snapshot truncado");
  });

  test("una página vacía devuelve string vacío, no una excepción", async () => {
    await backend.navigate(page("<body></body>"));
    expect(await backend.snapshot()).toBe("");
  });
});

// ─── snapshot por árbol de accesibilidad ──────────────────────────────────────

describe.skipIf(!LIVE)("WebViewBackend.snapshot vía CDP", () => {
  let backend: WebViewBackend;

  beforeEach(() => {
    backend = new WebViewBackend({ persistSession: false });
  });

  afterEach(() => {
    backend.close();
  });

  test("usa el árbol de accesibilidad de Chrome, no el recorrido del DOM", async () => {
    await backend.navigate(page(`<img src="x.png" alt="Un gato">`));
    const snapshot = await backend.snapshot();

    // La firma del AX tree: Chrome llama "image" a lo que el recorrido del DOM
    // etiquetaba "img". Si esto vuelve a decir "img", el fallback se comió la
    // ruta buena y nadie se entera.
    expect(snapshot).toContain('- image "Un gato"');
    expect(snapshot).not.toContain("- img ");
  });

  test("expone el puente CDP crudo para quien lo necesite", async () => {
    await backend.navigate(page("<h1>x</h1>"));
    const res = await backend.cdp<{ nodes?: unknown[] }>("Accessibility.getFullAXTree");
    expect(Array.isArray(res.nodes)).toBe(true);
  });
});

// ─── capturas con opciones ────────────────────────────────────────────────────

describe.skipIf(!LIVE)("WebViewBackend.screenshot", () => {
  let backend: WebViewBackend;

  beforeEach(() => {
    backend = new WebViewBackend({ persistSession: false });
  });

  afterEach(() => {
    backend.close();
  });

  test("honra format y quality en vez de devolver siempre un PNG", async () => {
    await backend.navigate(page("<h1>foto</h1>"));
    const jpeg = await backend.screenshot({ format: "jpeg", quality: 40 });
    // Cabecera JPEG (\xFF\xD8\xFF) en base64.
    expect(jpeg.startsWith("/9j/")).toBe(true);
  });

  test("honra clip: la captura recortada pesa menos que el viewport entero", async () => {
    await backend.navigate(page("<h1>foto</h1><div style='height:900px'></div>"));
    const completa = await backend.screenshot();
    const recorte = await backend.screenshot({
      format: "png",
      clip: { x: 0, y: 0, width: 80, height: 40, scale: 1 },
    });

    expect(recorte.startsWith("iVBORw0KGgo")).toBe(true);
    expect(recorte.length).toBeLessThan(completa.length);
  });
});

// ─── sesión persistente ───────────────────────────────────────────────────────

describe("normalizeCookies", () => {
  const futuro = Date.now() / 1000 + 3600;

  test("conserva las de sesión (expires -1), que son las del login", () => {
    const out = normalizeCookies([{ name: "sid", value: "abc", domain: "x.com", expires: -1 }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.expires).toBeUndefined();
  });

  test("descarta las ya vencidas", () => {
    const out = normalizeCookies([
      { name: "vieja", value: "1", domain: "x.com", expires: Date.now() / 1000 - 10 },
      { name: "viva", value: "2", domain: "x.com", expires: futuro },
    ]);
    expect(out.map((c) => c.name)).toEqual(["viva"]);
  });

  test("descarta lo que no es una cookie utilizable", () => {
    expect(normalizeCookies([{ value: "sin nombre", domain: "x.com" }, null, 7, "x"])).toEqual([]);
    expect(normalizeCookies("no es una lista")).toEqual([]);
  });

  test("se queda sólo con los campos que setCookies acepta de vuelta", () => {
    const [cookie] = normalizeCookies([
      { name: "a", value: "b", domain: "x.com", path: "/", secure: true, httpOnly: true, size: 99, priority: "Medium" },
    ]);
    expect(cookie).toEqual({
      name: "a",
      value: "b",
      domain: "x.com",
      path: "/",
      expires: undefined,
      httpOnly: true,
      secure: true,
      sameSite: undefined,
    });
  });
});

describe("sessionPersistenceEnabled", () => {
  const PREVIO = process.env.HIVE_BROWSER_PERSIST_SESSION;

  afterEach(() => {
    if (PREVIO === undefined) delete process.env.HIVE_BROWSER_PERSIST_SESSION;
    else process.env.HIVE_BROWSER_PERSIST_SESSION = PREVIO;
  });

  test("viene activa y la config la puede apagar", () => {
    delete process.env.HIVE_BROWSER_PERSIST_SESSION;
    expect(sessionPersistenceEnabled(undefined)).toBe(true);
    expect(sessionPersistenceEnabled(false)).toBe(false);
  });

  test("la variable de entorno pisa la config", () => {
    process.env.HIVE_BROWSER_PERSIST_SESSION = "0";
    expect(sessionPersistenceEnabled(true)).toBe(false);
    process.env.HIVE_BROWSER_PERSIST_SESSION = "1";
    expect(sessionPersistenceEnabled(false)).toBe(true);
  });
});

describe.skipIf(!LIVE)("sesión del navegador entre vistas", () => {
  // El keychain del sistema no es lugar para basura de test: se sustituye por
  // un doble, que es un caso que `storage/crypto.ts` ya contempla. El resto del
  // guardado va a la BD en memoria de este archivo.
  const SECRETS_REAL = (Bun as unknown as { secrets: unknown }).secrets;

  beforeEach(() => {
    (Bun as unknown as { secrets: unknown }).secrets = {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    };
  });

  afterEach(async () => {
    await clearStoredSession();
    (Bun as unknown as { secrets: unknown }).secrets = SECRETS_REAL;
  });

  test("las cookies vuelven en una vista nueva — el perfil de Bun es efímero", async () => {
    // Hace falta un servidor de verdad: una data: URL no tiene origen donde
    // guardar cookies.
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("<html><body>ok</body></html>", { headers: { "content-type": "text/html" } }),
    });
    const url = `http://localhost:${server.port}/`;

    const primera = new WebViewBackend({ persistSession: true });
    const segunda = new WebViewBackend({ persistSession: true });
    try {
      await primera.navigate(url);
      await primera.evaluate(`(() => { document.cookie = "hive_sesion=abc123; path=/"; return 1; })()`);
      await primera.flushSession();
      primera.close();

      await segunda.navigate(url);
      expect(await segunda.evaluate<string>("document.cookie")).toContain("hive_sesion=abc123");
    } finally {
      primera.close();
      segunda.close();
      server.stop(true);
    }
  });

  // Ojo con lo que este test NO puede afirmar: mientras haya otra vista abierta
  // en el mismo proceso, Bun reusa el mismo perfil de Chrome, así que dos
  // vistas hermanas ven las cookies de la otra sin que nadie las restaure. Lo
  // que sí está en nuestras manos —y es lo que se verifica— es que apagada la
  // persistencia no quede nada guardado para el proceso siguiente.
  test("con la persistencia apagada no se guarda nada en el almacén", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("<html><body>ok</body></html>", { headers: { "content-type": "text/html" } }),
    });
    const url = `http://localhost:${server.port}/`;

    const vista = new WebViewBackend({ persistSession: false });
    try {
      await vista.navigate(url);
      await vista.evaluate(`(() => { document.cookie = "hive_sesion=nope; path=/"; return 1; })()`);
      await vista.flushSession();

      expect(await loadStoredCookies()).toEqual([]);
    } finally {
      vista.close();
      server.stop(true);
    }
  });
});
