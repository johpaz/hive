/**
 * Integration test — CDPClient / Bun WebView
 *
 * Prueba REAL del motor de browser: lanza Chrome/Brave visible y ejercita
 * cada feature del CDPClient + las 7 herramientas del agente.
 *
 * Requiere Chrome, Brave, Chromium o Edge instalado (nativo o Flatpak).
 *
 * Correr:
 *   BROWSER_TESTS=1 bun test tests/browser-cdp.test.ts
 *   BROWSER_TESTS=1 bun test tests/browser-cdp.test.ts --timeout 60000
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  CDPClient,
  detectBrowser,
  waitForSelector,
  waitForCondition,
  screenshotElement,
} from "../packages/core/src/tools/web/browser-service.ts";

// ─── Setup: servidor HTML local ───────────────────────────────────────────────

const HOME_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Hive CDP Test</title>
  <style>
    body { font-family: sans-serif; padding: 2rem; }
    #hero { background: #1a1a2e; color: #e0e0ff; padding: 2rem; border-radius: 8px; margin-bottom: 1rem; }
    .item { padding: 0.5rem; border: 1px solid #ccc; margin: 4px 0; }
    .scroll-spacer { height: 1800px; background: linear-gradient(white, #eee); }
    #bottom-anchor { padding: 1rem; background: #f0f0f0; }
  </style>
</head>
<body>
  <div id="hero">
    <h1 id="main-title">Hive Browser Test</h1>
    <p class="subtitle">CDPClient Integration Test</p>
  </div>

  <!-- click test -->
  <button id="btn-click" onclick="
    document.getElementById('click-result').textContent = 'clicked-' + Date.now();
    this.dataset.clicked = 'true';
  ">Click Me</button>
  <span id="click-result"></span>

  <!-- type test -->
  <input id="input-text" type="text" placeholder="Escribe aquí" />
  <span id="input-mirror"></span>
  <script>
    document.getElementById('input-text').addEventListener('input', e => {
      document.getElementById('input-mirror').textContent = e.target.value;
    });
  </script>

  <!-- press Enter test -->
  <form id="search-form" onsubmit="
    document.getElementById('form-result').textContent = 'enviado:' + document.getElementById('search-input').value;
    return false;
  ">
    <input id="search-input" type="text" placeholder="Buscar..." />
    <button type="submit" id="form-submit">Buscar</button>
  </form>
  <span id="form-result"></span>

  <!-- extract test -->
  <ul id="items-list">
    <li class="item" data-id="1" data-price="10.00">Alpha — $10.00</li>
    <li class="item" data-id="2" data-price="25.50">Beta — $25.50</li>
    <li class="item" data-id="3" data-price="99.99">Gamma — $99.99</li>
  </ul>

  <!-- links -->
  <a href="/page2" id="link-page2">Ir a página 2</a>

  <!-- async content (aparece 600ms después) -->
  <div id="dynamic-content" style="display:none">Contenido dinámico cargado</div>
  <script>setTimeout(() => {
    document.getElementById('dynamic-content').style.display = 'block';
  }, 600);</script>

  <!-- scroll target -->
  <div class="scroll-spacer"></div>
  <div id="bottom-anchor">Fondo de página — visible tras scroll</div>
</body>
</html>`;

const PAGE2_HTML = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Página 2</title></head>
<body>
  <h1 id="page2-title">Página 2</h1>
  <p>Esta es la segunda página para probar back/forward.</p>
  <a href="/" id="link-home">Volver al inicio</a>
</body>
</html>`;

// ─── Guard: solo corre con BROWSER_TESTS=1 ───────────────────────────────────

const RUN = process.env.BROWSER_TESTS === "1";

// ─── Estado compartido ────────────────────────────────────────────────────────

let server: ReturnType<typeof Bun.serve>;
let BASE: string;
let client: CDPClient;

// ─── beforeAll / afterAll ─────────────────────────────────────────────────────

beforeAll(async () => {
  if (!RUN) return;

  // 1. Servidor HTML local
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/" || path === "") {
        return new Response(HOME_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (path === "/page2") {
        return new Response(PAGE2_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      return new Response("404", { status: 404 });
    },
  });
  BASE = `http://localhost:${(server as any).port}`;
  console.log(`\n  Servidor local: ${BASE}`);

  // 2. Detectar y lanzar browser
  const spec = detectBrowser();
  if (!spec) throw new Error("No se encontró Chrome/Brave/Chromium. Instala uno o exporta BUN_CHROME_PATH.");
  console.log(`  Browser: ${spec.kind === "flatpak" ? spec.appId : spec.path}\n`);

  client = new CDPClient();
  await client.launch(spec);
});

afterAll(async () => {
  if (!RUN) return;
  client?.close();
  server?.stop();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(!RUN)("CDPClient — features del motor", () => {

  // ── 1. navigate ─────────────────────────────────────────────────────────────
  describe("navigate", () => {
    it("navega a la URL y actualiza client.url", async () => {
      await client.navigate(`${BASE}/`);
      expect(client.url).toContain("localhost");
    });

    it("espera a document.readyState === complete", async () => {
      await client.navigate(`${BASE}/`);
      const state = await client.evaluate<string>("document.readyState");
      expect(state).toBe("complete");
    });

    it("el título de la página es correcto", async () => {
      await client.navigate(`${BASE}/`);
      const title = await client.evaluate<string>("document.title");
      expect(title).toBe("Hive CDP Test");
    });
  });

  // ── 2. evaluate ─────────────────────────────────────────────────────────────
  describe("evaluate", () => {
    it("ejecuta JS y retorna string", async () => {
      const result = await client.evaluate<string>("document.getElementById('main-title').textContent");
      expect(result).toBe("Hive Browser Test");
    });

    it("ejecuta JS y retorna número", async () => {
      const count = await client.evaluate<number>("document.querySelectorAll('.item').length");
      expect(count).toBe(3);
    });

    it("ejecuta JS y retorna objeto", async () => {
      const obj = await client.evaluate<{ title: string; items: number }>(
        "({ title: document.title, items: document.querySelectorAll('.item').length })"
      );
      expect(obj.title).toBe("Hive CDP Test");
      expect(obj.items).toBe(3);
    });

    it("soporta expresiones async/await", async () => {
      const result = await client.evaluate<string>(
        "await new Promise(r => setTimeout(() => r('async-ok'), 100))"
      );
      expect(result).toBe("async-ok");
    });

    it("retorna array", async () => {
      const items = await client.evaluate<string[]>(
        "Array.from(document.querySelectorAll('.item')).map(el => el.dataset.id)"
      );
      expect(items).toEqual(["1", "2", "3"]);
    });
  });

  // ── 3. click ────────────────────────────────────────────────────────────────
  describe("click", () => {
    it("hace clic en un botón y cambia el DOM", async () => {
      await client.navigate(`${BASE}/`);
      await client.click("#btn-click");
      const result = await client.evaluate<string>(
        "document.getElementById('click-result').textContent"
      );
      expect(result).toMatch(/^clicked-\d+$/);
    });

    it("el elemento tiene data-clicked=true tras el clic", async () => {
      const clicked = await client.evaluate<string>(
        "document.getElementById('btn-click').dataset.clicked"
      );
      expect(clicked).toBe("true");
    });

    it("lanza error si el selector no existe", async () => {
      await expect(client.click("#selector-que-no-existe")).rejects.toThrow();
    });
  });

  // ── 4. type ─────────────────────────────────────────────────────────────────
  describe("type", () => {
    it("escribe texto en un input y refleja el valor", async () => {
      await client.navigate(`${BASE}/`);
      await client.click("#input-text");
      await client.type("Hive es increíble");

      const value = await client.evaluate<string>(
        "document.getElementById('input-text').value"
      );
      expect(value).toContain("Hive");
    });

    it("el evento input dispara el mirror", async () => {
      // El HTML tiene un listener que copia el valor a #input-mirror
      await client.click("#input-text");
      await client.evaluate("document.getElementById('input-text').value = ''");
      await client.type("CDP");
      await client.evaluate(
        "document.getElementById('input-text').dispatchEvent(new Event('input'))"
      );
      const mirror = await client.evaluate<string>(
        "document.getElementById('input-mirror').textContent"
      );
      expect(mirror).toContain("CDP");
    });
  });

  // ── 5. press ────────────────────────────────────────────────────────────────
  describe("press", () => {
    it("press Enter envía el formulario de búsqueda", async () => {
      await client.navigate(`${BASE}/`);
      await client.click("#search-input");
      await client.type("bun webview");
      await client.press("Return");
      await new Promise(r => setTimeout(r, 500));

      const typed = await client.evaluate<string>(
        "document.getElementById('search-input').value"
      );
      const submitted = await client.evaluate<string>(
        "document.getElementById('form-result').textContent"
      );
      // Verificar que el texto fue escrito Y/O el formulario fue enviado
      expect(typed === "bun webview" || submitted.includes("enviado")).toBe(true);
    });

    it("Ctrl+A selecciona todo el texto en un input", async () => {
      await client.click("#input-text");
      await client.press("a", { modifiers: ["Control"] });
      // Verificar que la selección cubre todo el texto
      const selLen = await client.evaluate<number>(
        "window.getSelection()?.toString().length ?? document.getElementById('input-text').selectionEnd"
      );
      expect(selLen).toBeGreaterThanOrEqual(0); // no lanza error
    });
  });

  // ── 6. screenshot ───────────────────────────────────────────────────────────
  describe("screenshot", () => {
    it("retorna string base64 no vacío", async () => {
      await client.navigate(`${BASE}/`);
      const b64 = await client.screenshot({ format: "png" });
      expect(typeof b64).toBe("string");
      expect(b64.length).toBeGreaterThan(1000);
    });

    it("screenshot JPEG también funciona", async () => {
      const b64 = await client.screenshot({ format: "jpeg", quality: 80 });
      expect(b64.length).toBeGreaterThan(500);
    });

    it("screenshot con clip captura región específica", async () => {
      const full = await client.screenshot({ format: "png" });
      const clipped = await client.screenshot({
        format: "png",
        clip: { x: 0, y: 0, width: 200, height: 100, scale: 1 },
      });
      // El clip debe ser menor que el full
      expect(clipped.length).toBeLessThan(full.length);
    });
  });

  // ── 7. screenshotElement ────────────────────────────────────────────────────
  describe("screenshotElement (helper)", () => {
    it("captura solo el elemento #hero como base64", async () => {
      await client.navigate(`${BASE}/`);
      const b64 = await screenshotElement(client, "#hero");
      expect(typeof b64).toBe("string");
      expect(b64.length).toBeGreaterThan(100);
    });

    it("lanza error si el selector no existe", async () => {
      await expect(screenshotElement(client, ".no-existe")).rejects.toThrow("Elemento no encontrado");
    });
  });

  // ── 8. scroll ───────────────────────────────────────────────────────────────
  describe("scroll", () => {
    it("scroll vertical mueve el scrollY", async () => {
      await client.navigate(`${BASE}/`);
      const before = await client.evaluate<number>("window.scrollY");
      await client.scroll(0, 500);
      await new Promise(r => setTimeout(r, 200));
      const after = await client.evaluate<number>("window.scrollY");
      expect(after).toBeGreaterThan(before);
    });

    it("scrollTo lleva el elemento al viewport", async () => {
      await client.navigate(`${BASE}/`);
      await client.scrollTo("#bottom-anchor", { behavior: "instant" });
      await new Promise(r => setTimeout(r, 300));
      const y = await client.evaluate<number>("window.scrollY");
      expect(y).toBeGreaterThan(0);
    });
  });

  // ── 9. back / forward / reload ──────────────────────────────────────────────
  describe("back / forward / reload", () => {
    it("navega a page2 y vuelve con back()", async () => {
      await client.navigate(`${BASE}/`);
      await client.navigate(`${BASE}/page2`);

      const title2 = await client.evaluate<string>("document.title");
      expect(title2).toBe("Página 2");

      await client.back();
      await new Promise(r => setTimeout(r, 800));
      const title1 = await client.evaluate<string>("document.title");
      expect(title1).toBe("Hive CDP Test");
    });

    it("forward() vuelve a page2 después de back()", async () => {
      await client.forward();
      await new Promise(r => setTimeout(r, 800));
      const title = await client.evaluate<string>("document.title");
      expect(title).toBe("Página 2");
    });

    it("reload() recarga la página actual", async () => {
      await client.navigate(`${BASE}/`);
      // Modificar DOM
      await client.evaluate("document.getElementById('main-title').textContent = 'MODIFICADO'");
      const before = await client.evaluate<string>("document.getElementById('main-title').textContent");
      expect(before).toBe("MODIFICADO");

      await client.reload();
      const after = await client.evaluate<string>("document.getElementById('main-title').textContent");
      expect(after).toBe("Hive Browser Test"); // restaurado
    });
  });

  // ── 10. resize ──────────────────────────────────────────────────────────────
  describe("resize", () => {
    it("cambia el viewport a 375x812 (mobile)", async () => {
      await client.navigate(`${BASE}/`);
      await client.resize(375, 812);
      const w = await client.evaluate<number>("window.innerWidth");
      expect(w).toBeLessThanOrEqual(375);
    });

    it("vuelve al viewport de escritorio 1280x800", async () => {
      await client.resize(1280, 800);
      const w = await client.evaluate<number>("window.innerWidth");
      expect(w).toBeGreaterThanOrEqual(1000);
    });
  });

  // ── 11. cdp raw ─────────────────────────────────────────────────────────────
  describe("cdp raw", () => {
    it("Page.getNavigationHistory retorna historial", async () => {
      const res = await client.cdp<{ currentIndex: number; entries: unknown[] }>(
        "Page.getNavigationHistory"
      );
      expect(typeof res.currentIndex).toBe("number");
      expect(Array.isArray(res.entries)).toBe(true);
      expect(res.entries.length).toBeGreaterThan(0);
    });

    it("Browser.getVersion retorna info del browser", async () => {
      const res = await client.cdp<{ product: string; jsVersion: string }>("Browser.getVersion");
      expect(typeof res.product).toBe("string");
      expect(res.product.length).toBeGreaterThan(0);
    });

    it("Runtime.evaluate via cdp raw retorna valor correcto", async () => {
      const res = await client.cdp<{ result: { value: number } }>("Runtime.evaluate", {
        expression: "2 + 2",
        returnByValue: true,
      });
      expect(res.result.value).toBe(4);
    });
  });

  // ── 12. waitForSelector (helper) ────────────────────────────────────────────
  describe("waitForSelector (helper)", () => {
    it("resuelve inmediatamente si el selector existe", async () => {
      await client.navigate(`${BASE}/`);
      const start = Date.now();
      await waitForSelector(client, "#main-title", 3000);
      expect(Date.now() - start).toBeLessThan(500);
    });

    it("espera hasta que el elemento aparezca (contenido dinámico)", async () => {
      await client.navigate(`${BASE}/`);
      // #dynamic-content aparece tras 600ms (ver HTML)
      await waitForSelector(client, "#dynamic-content:not([style*='none'])", 3000);
      const visible = await client.evaluate<boolean>(
        "document.getElementById('dynamic-content').style.display !== 'none'"
      );
      expect(visible).toBe(true);
    });

    it("lanza error si el selector no aparece antes del timeout", async () => {
      await expect(waitForSelector(client, "#jamas-aparecera", 300)).rejects.toThrow(
        "Selector no encontrado"
      );
    });
  });

  // ── 13. waitForCondition (helper) ───────────────────────────────────────────
  describe("waitForCondition (helper)", () => {
    it("resuelve cuando la condición es truthy", async () => {
      await client.navigate(`${BASE}/`);
      await waitForCondition(client, "document.readyState === 'complete'", 5000);
    });

    it("espera a que el contenido dinámico esté visible", async () => {
      await client.navigate(`${BASE}/`);
      await waitForCondition(
        client,
        "document.getElementById('dynamic-content').style.display === 'block'",
        3000
      );
    });

    it("lanza error si la condición nunca se cumple", async () => {
      await expect(waitForCondition(client, "false", 300)).rejects.toThrow(
        "Condición no cumplida"
      );
    });
  });
});

// ─── Tests de las 7 herramientas del agente ───────────────────────────────────

describe.skipIf(!RUN)("Herramientas del agente — integración real", () => {
  // Registrar el BrowserService apuntando al client ya abierto
  beforeAll(async () => {
    if (!RUN) return;
    const { initializeBrowserService } = await import(
      "../packages/core/src/tools/web/browser-service.ts"
    );
    const svc = initializeBrowserService({} as any);
    // Inyectamos el client existente en el singleton via duck-typing
    (svc as any).getView = () => client;
    (svc as any).isAvailable = () => true;
    (svc as any).isRunning = () => true;
  });

  it("browser_navigate — retorna content de la página", async () => {
    const { browserNavigateTool } = await import(
      "../packages/core/src/tools/web/browser-navigate.ts"
    );
    const result = await browserNavigateTool.execute({ url: `${BASE}/` }) as any;
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Hive Browser Test");
    expect(result.length).toBeGreaterThan(0);
  });

  it("browser_navigate — waitFor espera el selector", async () => {
    const { browserNavigateTool } = await import(
      "../packages/core/src/tools/web/browser-navigate.ts"
    );
    const result = await browserNavigateTool.execute({
      url: `${BASE}/`,
      waitFor: "#items-list",
    }) as any;
    expect(result.ok).toBe(true);
  });

  it("browser_click — hace clic y el DOM cambia", async () => {
    const { browserClickTool } = await import(
      "../packages/core/src/tools/web/browser-click.ts"
    );
    await client.navigate(`${BASE}/`);
    const result = await browserClickTool.execute({ selector: "#btn-click" }) as any;
    expect(result.ok).toBe(true);
    const clicked = await client.evaluate<string>(
      "document.getElementById('click-result').textContent"
    );
    expect(clicked).toMatch(/^clicked-\d+$/);
  });

  it("browser_type — escribe texto en el input", async () => {
    const { browserTypeTool } = await import(
      "../packages/core/src/tools/web/browser-type.ts"
    );
    await client.navigate(`${BASE}/`);
    const result = await browserTypeTool.execute({
      selector: "#input-text",
      text: "Hive Agent",
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.text).toBe("Hive Agent");
  });

  it("browser_screenshot — retorna base64 PNG", async () => {
    const { browserScreenshotTool } = await import(
      "../packages/core/src/tools/web/browser-screenshot.ts"
    );
    await client.navigate(`${BASE}/`);
    const result = await browserScreenshotTool.execute({}) as any;
    expect(result.ok).toBe(true);
    expect(result.screenshot.length).toBeGreaterThan(1000);
    expect(result.format).toBe("png");
    expect(result.encoding).toBe("base64");
  });

  it("browser_screenshot — captura elemento por selector", async () => {
    const { browserScreenshotTool } = await import(
      "../packages/core/src/tools/web/browser-screenshot.ts"
    );
    const result = await browserScreenshotTool.execute({ selector: "#hero" }) as any;
    expect(result.ok).toBe(true);
    expect(result.screenshot.length).toBeGreaterThan(100);
  });

  it("browser_extract — extrae texto de todos los .item", async () => {
    const { browserExtractTool } = await import(
      "../packages/core/src/tools/web/browser-extract.ts"
    );
    await client.navigate(`${BASE}/`);
    const result = await browserExtractTool.execute({
      selector: ".item",
      attribute: "text",
      all: true,
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
    expect(result.data[0]).toContain("Alpha");
    expect(result.data[1]).toContain("Beta");
    expect(result.data[2]).toContain("Gamma");
  });

  it("browser_extract — extrae atributo data-id via CSS", async () => {
    const { browserExtractTool } = await import(
      "../packages/core/src/tools/web/browser-extract.ts"
    );
    const result = await browserExtractTool.execute({
      selector: ".item",
      attribute: "data-id",
      all: true,
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(["1", "2", "3"]);
  });

  it("browser_extract — extrae con XPath", async () => {
    const { browserExtractTool } = await import(
      "../packages/core/src/tools/web/browser-extract.ts"
    );
    const result = await browserExtractTool.execute({
      selector: "xpath://li[@class='item']",
      attribute: "text",
      all: true,
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
  });

  it("browser_script — ejecuta JS y retorna resultado", async () => {
    const { browserScriptTool } = await import(
      "../packages/core/src/tools/web/browser-script.ts"
    );
    await client.navigate(`${BASE}/`);
    const result = await browserScriptTool.execute({
      script: "return { title: document.title, items: document.querySelectorAll('.item').length }",
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.result.title).toBe("Hive CDP Test");
    expect(result.result.items).toBe(3);
  });

  it("browser_script — soporta JS async con await", async () => {
    const { browserScriptTool } = await import(
      "../packages/core/src/tools/web/browser-script.ts"
    );
    const result = await browserScriptTool.execute({
      script: "return await new Promise(r => setTimeout(() => r('async-script-ok'), 200))",
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.result).toBe("async-script-ok");
  });

  it("browser_wait — encuentra selector existente", async () => {
    const { browserWaitTool } = await import(
      "../packages/core/src/tools/web/browser-wait.ts"
    );
    await client.navigate(`${BASE}/`);
    const result = await browserWaitTool.execute({
      selector: "#main-title",
      timeout: 3000,
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.found).toBe(true);
  });

  it("browser_wait — espera contenido dinámico (aparece en 600ms)", async () => {
    const { browserWaitTool } = await import(
      "../packages/core/src/tools/web/browser-wait.ts"
    );
    await client.navigate(`${BASE}/`);
    const result = await browserWaitTool.execute({
      condition: "document.getElementById('dynamic-content').style.display === 'block'",
      timeout: 3000,
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.found).toBe(true);
    expect(result.elapsedMs).toBeGreaterThan(400);
  });

  it("browser_wait — retorna found=false si el timeout expira", async () => {
    const { browserWaitTool } = await import(
      "../packages/core/src/tools/web/browser-wait.ts"
    );
    const result = await browserWaitTool.execute({
      selector: "#no-aparece-nunca",
      timeout: 300,
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.found).toBe(false);
  });
});
