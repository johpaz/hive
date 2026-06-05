/**
 * Tests para las herramientas de browser basadas en Bun.WebView
 *
 * Estructura:
 *  - Unit tests: mock del BrowserService, sin Chrome real
 *  - Integration tests: Chrome real, gateados por BROWSER_TESTS=1
 *
 * Correr unit tests:     bun test tests/browser-tools.test.ts
 * Correr todos:          BROWSER_TESTS=1 bun test tests/browser-tools.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { writeFileSync, rmSync } from "fs";

// ─── Tipos mínimos para el mock ───────────────────────────────────────────────

interface MockView {
  url: string;
  title: string;
  navigate: ReturnType<typeof mock>;
  evaluate: ReturnType<typeof mock>;
  snapshot: ReturnType<typeof mock>;
  screenshot: ReturnType<typeof mock>;
  click: ReturnType<typeof mock>;
  type: ReturnType<typeof mock>;
  typeIn: ReturnType<typeof mock>;
  fill: ReturnType<typeof mock>;
  press: ReturnType<typeof mock>;
  scroll: ReturnType<typeof mock>;
  scrollTo: ReturnType<typeof mock>;
  resize: ReturnType<typeof mock>;
  run: ReturnType<typeof mock>;
  cdp: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
}

function createMockView(overrides: Partial<MockView> = {}): MockView {
  return {
    url: "https://example.com",
    title: "Example",
    navigate: mock(async () => {}),
    evaluate: mock(async () => ""),
    snapshot: mock(async () => "- document\n  - link \"Example\" [ref=e1]"),
    screenshot: mock(async () => "base64encodedpng=="),
    click: mock(async () => {}),
    type: mock(async () => {}),
    typeIn: mock(async () => {}),
    fill: mock(async () => {}),
    press: mock(async () => {}),
    scroll: mock(async () => {}),
    scrollTo: mock(async () => {}),
    resize: mock(async () => {}),
    run: mock(async () => ({ success: true, data: { path: "/tmp/mock.png" } })),
    cdp: mock(async () => ({ data: "base64png==" })),
    close: mock(() => {}),
    ...overrides,
  };
}

// ─── Mock del BrowserService ─────────────────────────────────────────────────

function createMockService(view: MockView | null = null) {
  return {
    getView: async () => view,
    getPage: async () => view,
    isAvailable: () => view !== null,
    isRunning: () => view !== null,
    start: mock(async () => view !== null),
    stop: mock(async () => {}),
    dispose: mock(async () => {}),
    getInfo: () => ({ running: view !== null }),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe("waitForSelector", () => {
  it("resuelve cuando el selector aparece en el primer intento", async () => {
    const { waitForSelector } = await import("../packages/core/src/tools/web/browser-service.ts");
    const view = createMockView({
      evaluate: mock(async () => true),
    });

    await expect(waitForSelector(view as any, "#btn", 1000)).resolves.toBeUndefined();
    expect(view.evaluate).toHaveBeenCalledTimes(1);
  });

  it("resuelve cuando el selector aparece en el segundo intento", async () => {
    const { waitForSelector } = await import("../packages/core/src/tools/web/browser-service.ts");
    let calls = 0;
    const view = createMockView({
      evaluate: mock(async () => {
        calls++;
        return calls >= 2;
      }),
    });

    await expect(waitForSelector(view as any, ".item", 500)).resolves.toBeUndefined();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("lanza error cuando el selector no aparece antes del timeout", async () => {
    const { waitForSelector } = await import("../packages/core/src/tools/web/browser-service.ts");
    const view = createMockView({
      evaluate: mock(async () => false),
    });

    await expect(waitForSelector(view as any, ".missing", 150)).rejects.toThrow("Selector no encontrado");
  });
});

describe("waitForCondition", () => {
  it("resuelve cuando la condición es truthy", async () => {
    const { waitForCondition } = await import("../packages/core/src/tools/web/browser-service.ts");
    const view = createMockView({
      evaluate: mock(async () => true),
    });

    await expect(waitForCondition(view as any, "window.ready === true", 500)).resolves.toBeUndefined();
  });

  it("lanza error cuando la condición nunca se cumple", async () => {
    const { waitForCondition } = await import("../packages/core/src/tools/web/browser-service.ts");
    const view = createMockView({
      evaluate: mock(async () => false),
    });

    await expect(waitForCondition(view as any, "false", 150)).rejects.toThrow("Condición no cumplida");
  });
});

describe("screenshotElement", () => {
  it("retorna base64 del screenshot cuando el elemento existe", async () => {
    const tmpPath = "/tmp/test-screenshot.png";
    writeFileSync(tmpPath, "fake-png-data");

    const { screenshotElement } = await import("../packages/core/src/tools/web/browser-service.ts");
    const view = createMockView({
      run: mock(async () => ({ success: true, data: { path: tmpPath } })),
    });

    const result = await screenshotElement(view as any, "#logo");
    expect(typeof result).toBe("string");
    expect(view.run).toHaveBeenCalledWith(["screenshot", "#logo"]);

    try { rmSync(tmpPath); } catch { /* already cleaned by screenshotElement */ }
  });

  it("lanza error cuando el elemento no existe", async () => {
    const { screenshotElement } = await import("../packages/core/src/tools/web/browser-service.ts");
    const view = createMockView({
      run: mock(async () => ({ success: false, error: "Element not found" })),
    });

    await expect(screenshotElement(view as any, ".missing")).rejects.toThrow("Element not found");
  });
});

// ─── Herramientas individuales ────────────────────────────────────────────────

describe("browser_navigate", () => {
  it("retorna error cuando el browser no está disponible", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-navigate.ts");
    // Mockear getBrowserService para retornar null
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(null);

    const result = await mod.browserNavigateTool.execute({ url: "https://example.com" });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("not available") });

    spy.mockRestore();
  });

  it("retorna contenido cuando la navegación es exitosa", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-navigate.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView({
      url: "https://example.com",
      snapshot: mock(async () => "- document\n  - link \"Example\" [ref=e1]"),
    });
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    const result = await mod.browserNavigateTool.execute({ url: "https://example.com" }) as any;
    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://example.com");
    expect(result.finalUrl).toBe("https://example.com");
    expect(result.contentType).toBe("snapshot");
    expect(view.navigate).toHaveBeenCalledWith("https://example.com");

    spy.mockRestore();
  });

  it("espera el selector waitFor si se proporciona", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-navigate.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView({
      evaluate: mock(async (script: string) => {
        if (script.includes("querySelector")) return true; // selector encontrado
        return "contenido";
      }),
      snapshot: mock(async () => "- document\n  - link \"Example\" [ref=e1]"),
    });
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    const result = await mod.browserNavigateTool.execute({
      url: "https://example.com",
      waitFor: "#main",
    }) as any;
    expect(result.ok).toBe(true);

    spy.mockRestore();
  });
});

describe("browser_click", () => {
  it("retorna error cuando el browser no está disponible", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-click.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(null);

    const result = await mod.browserClickTool.execute({ selector: "#btn" });
    expect(result).toMatchObject({ ok: false });

    spy.mockRestore();
  });

  it("llama navigate y click con los parámetros correctos", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-click.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView({ url: "https://example.com/page" });
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    const result = await mod.browserClickTool.execute({
      selector: "#submit",
      url: "https://example.com/page",
      timeout: 5000,
    }) as any;

    expect(result.ok).toBe(true);
    expect(result.selector).toBe("#submit");
    expect(view.navigate).toHaveBeenCalledWith("https://example.com/page");
    expect(view.click).toHaveBeenCalledWith("#submit", expect.objectContaining({ timeout: 5000 }));

    spy.mockRestore();
  });

  it("no navega si no se proporciona url", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-click.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView();
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    await mod.browserClickTool.execute({ selector: ".link" });
    expect(view.navigate).not.toHaveBeenCalled();
    expect(view.click).toHaveBeenCalledWith(".link", expect.any(Object));

    spy.mockRestore();
  });
});

describe("browser_script", () => {
  it("ejecuta el script y retorna el resultado", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-script.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView({
      evaluate: mock(async () => 42),
    });
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    const result = await mod.browserScriptTool.execute({ script: "return 42" }) as any;
    expect(result.ok).toBe(true);
    expect(result.result).toBe(42);

    spy.mockRestore();
  });

  it("navega antes de ejecutar si se pasa url", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-script.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView({ evaluate: mock(async () => "ok") });
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    await mod.browserScriptTool.execute({
      url: "https://example.com",
      script: "document.title",
    });
    expect(view.navigate).toHaveBeenCalledWith("https://example.com");

    spy.mockRestore();
  });
});

describe("browser_type", () => {
  it("usa fill cuando clear=true", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-type.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView();
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    const result = await mod.browserTypeTool.execute({
      selector: "input#search",
      text: "Hola mundo",
      clear: true,
    }) as any;

    expect(result.ok).toBe(true);
    expect(view.fill).toHaveBeenCalledWith("input#search", "Hola mundo");

    spy.mockRestore();
  });

  it("usa typeIn cuando clear=false", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-type.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView();
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    await mod.browserTypeTool.execute({
      selector: "input",
      text: "texto",
      clear: false,
    });

    expect(view.typeIn).toHaveBeenCalledWith("input", "texto");

    spy.mockRestore();
  });
});

describe("browser_screenshot", () => {
  it("retorna screenshot en base64 del viewport", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-screenshot.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView({
      screenshot: mock(async () => "fullpagebase64=="),
    });
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    const result = await mod.browserScreenshotTool.execute({}) as any;
    expect(result.ok).toBe(true);
    expect(result.screenshot).toBe("fullpagebase64==");
    expect(result.format).toBe("jpeg");
    expect(result.encoding).toBe("base64");

    spy.mockRestore();
  });

  it("usa screenshotElement cuando se pasa selector", async () => {
    const tmpPath = "/tmp/test-screenshot-hero.png";
    writeFileSync(tmpPath, "fake-png-data");

    const mod = await import("../packages/core/src/tools/web/browser-screenshot.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView({
      run: mock(async () => ({ success: true, data: { path: tmpPath } })),
    });
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    const result = await mod.browserScreenshotTool.execute({ selector: "#hero" }) as any;
    expect(result.ok).toBe(true);
    expect(typeof result.screenshot).toBe("string");

    spy.mockRestore();
    try { rmSync(tmpPath); } catch { /* already cleaned by screenshotElement */ }
  });

  it("navega a la url antes del screenshot si se proporciona", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-screenshot.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView();
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    await mod.browserScreenshotTool.execute({ url: "https://example.com" });
    expect(view.navigate).toHaveBeenCalledWith("https://example.com");

    spy.mockRestore();
  });
});

describe("browser_extract", () => {
  it("extrae texto con selector CSS", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-extract.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView({
      evaluate: mock(async (script: string) => {
        if (script.includes("!!document.querySelector")) return true; // waitForSelector
        return ["Título 1", "Título 2"]; // extracción
      }),
    });
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    const result = await mod.browserExtractTool.execute({
      selector: "h2",
      attribute: "text",
    }) as any;

    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(result.data).toEqual(["Título 1", "Título 2"]);

    spy.mockRestore();
  });

  it("navega a la url antes de extraer", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-extract.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView({
      evaluate: mock(async () => []),
    });
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    await mod.browserExtractTool.execute({
      url: "https://example.com",
      selector: ".item",
    });
    expect(view.navigate).toHaveBeenCalledWith("https://example.com");

    spy.mockRestore();
  });
});

describe("browser_wait", () => {
  it("retorna error si no se pasa selector ni condition", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-wait.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView();
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    const result = await mod.browserWaitTool.execute({}) as any;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("selector");

    spy.mockRestore();
  });

  it("retorna found=true cuando el selector es encontrado", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-wait.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView({
      evaluate: mock(async () => true),
    });
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    const result = await mod.browserWaitTool.execute({
      selector: "#content",
      timeout: 1000,
    }) as any;

    expect(result.ok).toBe(true);
    expect(result.found).toBe(true);

    spy.mockRestore();
  });

  it("retorna found=false cuando el selector no aparece en el timeout", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-wait.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView({
      evaluate: mock(async () => false),
    });
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    const result = await mod.browserWaitTool.execute({
      selector: ".missing",
      timeout: 150,
    }) as any;

    expect(result.ok).toBe(true);
    expect(result.found).toBe(false);

    spy.mockRestore();
  });

  it("espera por condition JS cuando se proporciona", async () => {
    const mod = await import("../packages/core/src/tools/web/browser-wait.ts");
    const browserServiceMod = await import("../packages/core/src/tools/web/browser-service.ts");

    const view = createMockView({
      evaluate: mock(async () => true),
    });
    const service = createMockService(view);
    const spy = spyOn(browserServiceMod, "getBrowserService").mockReturnValue(service as any);

    const result = await mod.browserWaitTool.execute({
      condition: "document.readyState === 'complete'",
      timeout: 1000,
    }) as any;

    expect(result.ok).toBe(true);
    expect(result.found).toBe(true);
    expect(result.condition).toBe("document.readyState === 'complete'");

    spy.mockRestore();
  });
});

// ─── Estructura de las herramientas (sin browser real) ────────────────────────

describe("Estructura de las herramientas", () => {
  const toolModules = [
    { name: "browser_navigate", mod: () => import("../packages/core/src/tools/web/browser-navigate.ts"), export: "browserNavigateTool" },
    { name: "browser_click", mod: () => import("../packages/core/src/tools/web/browser-click.ts"), export: "browserClickTool" },
    { name: "browser_extract", mod: () => import("../packages/core/src/tools/web/browser-extract.ts"), export: "browserExtractTool" },
    { name: "browser_screenshot", mod: () => import("../packages/core/src/tools/web/browser-screenshot.ts"), export: "browserScreenshotTool" },
    { name: "browser_script", mod: () => import("../packages/core/src/tools/web/browser-script.ts"), export: "browserScriptTool" },
    { name: "browser_type", mod: () => import("../packages/core/src/tools/web/browser-type.ts"), export: "browserTypeTool" },
    { name: "browser_wait", mod: () => import("../packages/core/src/tools/web/browser-wait.ts"), export: "browserWaitTool" },
  ];

  for (const { name, mod, export: exportName } of toolModules) {
    it(`${name} exporta la estructura correcta de Tool`, async () => {
      const m = await mod() as any;
      const tool = m[exportName];
      expect(tool).toBeDefined();
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.execute).toBe("function");
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe("object");
      expect(tool.parameters.properties).toBeDefined();
      expect(tool.name).toBe(name);
    });
  }
});

// ─── Integration tests (solo con BROWSER_TESTS=1) ────────────────────────────

const BROWSER_TESTS = process.env.BROWSER_TESTS === "1";

describe.skipIf(!BROWSER_TESTS)("Integration: Chrome real", () => {
  let BrowserService: any;
  let serviceInstance: any;

  beforeEach(async () => {
    const mod = await import("../packages/core/src/tools/web/browser-service.ts");
    BrowserService = mod.BrowserService;
    serviceInstance = BrowserService.getInstance({} as any);
  });

  afterEach(async () => {
    if (serviceInstance) {
      await serviceInstance.stop();
    }
  });

  it("inicia Chrome en modo visible", async () => {
    const ok = await serviceInstance.start();
    expect(ok).toBe(true);
    expect(serviceInstance.isAvailable()).toBe(true);
    expect(serviceInstance.getView()).not.toBeNull();
  });

  it("navega a example.com y extrae el título", async () => {
    await serviceInstance.start();
    const view = serviceInstance.getView();
    await view.navigate("https://example.com");
    const title = await view.evaluate("document.title");
    expect(typeof title).toBe("string");
    expect(title.length).toBeGreaterThan(0);
  });

  it("toma un screenshot como base64", async () => {
    await serviceInstance.start();
    const view = serviceInstance.getView();
    await view.navigate("https://example.com");
    const screenshot = await view.screenshot({ encoding: "base64", format: "png" });
    expect(typeof screenshot).toBe("string");
    expect(screenshot.length).toBeGreaterThan(100);
  });

  it("evalúa JS en la página y retorna el resultado", async () => {
    await serviceInstance.start();
    const view = serviceInstance.getView();
    await view.navigate("data:text/html,<h1 id='test'>Hola</h1>");
    const text = await view.evaluate("document.getElementById('test').textContent");
    expect(text).toBe("Hola");
  });

  it("browser_navigate tool funciona end-to-end", async () => {
    await serviceInstance.start();

    // Registrar la instancia en el módulo
    const serviceMod = await import("../packages/core/src/tools/web/browser-service.ts");
    const spy = spyOn(serviceMod, "getBrowserService").mockReturnValue(serviceInstance);

    const { browserNavigateTool } = await import("../packages/core/src/tools/web/browser-navigate.ts");
    const result = await browserNavigateTool.execute({ url: "https://example.com" }) as any;

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Example");

    spy.mockRestore();
  });
});
