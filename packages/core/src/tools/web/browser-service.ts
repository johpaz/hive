/**
 * BrowserService - Gestiona Chrome via Bun.WebView (nativo Bun v1.3.12+)
 *
 * Chrome corre en modo VISIBLE — el usuario ve todas las acciones del agente
 * en tiempo real. Auto-detecta Chrome ya abierto con remote debugging,
 * sino abre una ventana nueva.
 */

import { logger } from "../../utils/logger.ts";
import type { Config } from "../../config/loader.ts";
import { existsSync } from "fs";

const log = logger.child("browser-service");

// Bun.WebView está disponible en Bun v1.3.12+ pero @types/bun aún no lo incluye
// Se declara aquí hasta que los tipos oficiales se actualicen
declare namespace Bun {
  class WebView {
    constructor(options?: {
      backend?: "webkit" | "chrome" | { type: "chrome"; argv?: string[]; path?: string; url?: false | string };
      width?: number;
      height?: number;
      headless?: boolean;
      url?: string;
    });
    readonly url: string;
    readonly title: string;
    readonly loading: boolean;
    navigate(url: string): Promise<void>;
    evaluate<T = unknown>(script: string): Promise<T>;
    screenshot(options?: { encoding?: "blob" | "buffer" | "base64" | "shmem"; format?: "png" | "jpeg" | "webp"; quality?: number }): Promise<string>;
    click(x: number, y: number, options?: Record<string, unknown>): Promise<void>;
    click(selector: string, options?: { timeout?: number; button?: string; modifiers?: string[]; clickCount?: number }): Promise<void>;
    type(text: string): Promise<void>;
    press(key: string, options?: { modifiers?: string[] }): Promise<void>;
    scroll(dx: number, dy: number): Promise<void>;
    scrollTo(selector: string, options?: Record<string, unknown>): Promise<void>;
    resize(width: number, height: number): Promise<void>;
    back(): Promise<void>;
    forward(): Promise<void>;
    reload(): Promise<void>;
    cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
    close(): void;
    static closeAll(): void;
    [Symbol.dispose](): void;
    [Symbol.asyncDispose](): void;
  }
}

type WebView = InstanceType<typeof Bun.WebView>;

let _view: WebView | null = null;
let _available = false;

const CHROME_PATHS_BY_PLATFORM: Record<string, string[]> = {
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
    // Flatpak (Fedora, Arch, Ubuntu)
    "/var/lib/flatpak/app/com.google.Chrome/current/active/files/extra/chrome",
    `${process.env.HOME}/.local/share/flatpak/app/com.google.Chrome/current/active/files/extra/chrome`,
    "/var/lib/flatpak/app/org.chromium.Chromium/current/active/files/chromium",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  ],
  win32: [
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Chromium\\Application\\chrome.exe`,
  ],
};

function detectChromePath(): string | undefined {
  if (process.env.BUN_CHROME_PATH && existsSync(process.env.BUN_CHROME_PATH)) {
    return process.env.BUN_CHROME_PATH;
  }
  const platform = process.platform as string;
  const candidates = CHROME_PATHS_BY_PLATFORM[platform] ?? CHROME_PATHS_BY_PLATFORM.linux;
  return candidates.filter(Boolean).find(p => existsSync(p));
}

export class BrowserService {
  private static instance: BrowserService | null = null;

  private constructor(_config: Config) {}

  static getInstance(config: Config): BrowserService {
    if (!BrowserService.instance) {
      BrowserService.instance = new BrowserService(config);
    }
    return BrowserService.instance;
  }

  async start(): Promise<boolean> {
    try {
      const chromePath = detectChromePath();
      if (!chromePath) {
        log.warn("Chrome/Chromium no encontrado. Instala Chrome o exporta BUN_CHROME_PATH=/ruta/a/chrome");
        _available = false;
        return false;
      }
      log.info(`Iniciando Chrome via Bun.WebView: ${chromePath}`);
      _view = new Bun.WebView({
        backend: {
          type: "chrome",
          path: chromePath,
          argv: ["--headless=false", "--no-sandbox", "--disable-dev-shm-usage"],
        },
        width: 1280,
        height: 800,
      });
      _available = true;
      log.info("✅ Chrome abierto — el usuario verá todas las acciones del agente");
      return true;
    } catch (err) {
      log.warn(`Chrome no disponible: ${(err as Error).message}`);
      log.warn("   Linux: sudo dnf install chromium  |  Flatpak: flatpak install com.google.Chrome");
      _available = false;
      return false;
    }
  }

  getView(): WebView | null {
    return _view;
  }

  // Alias para compatibilidad con captcha (solver.ts aún en migración)
  async getPage(): Promise<WebView | null> {
    return _view;
  }

  isAvailable(): boolean {
    return _available && _view !== null;
  }

  isRunning(): boolean {
    return _available && _view !== null;
  }

  getInfo(): { running: boolean } {
    return { running: this.isRunning() };
  }

  async stop(): Promise<void> {
    if (_view) {
      try {
        Bun.WebView.closeAll();
        log.info("✅ Chrome cerrado");
      } catch (err) {
        log.error(`Error cerrando Chrome: ${(err as Error).message}`);
      }
      _view = null;
    }
    _available = false;
  }

  async dispose(): Promise<void> {
    await this.stop();
    BrowserService.instance = null;
    log.info("BrowserService disposed");
  }
}

let browserServiceInstance: BrowserService | null = null;

export function initializeBrowserService(config: Config): BrowserService {
  browserServiceInstance = BrowserService.getInstance(config);
  return browserServiceInstance;
}

export function getBrowserService(): BrowserService | null {
  return browserServiceInstance;
}

/**
 * Espera a que un selector CSS aparezca en el DOM.
 * Equivalente a page.waitForSelector() de Puppeteer.
 */
export async function waitForSelector(
  view: WebView,
  selector: string,
  timeout = 30000
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await view.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`);
    if (found) return;
    await new Promise<void>(r => setTimeout(r, 100));
  }
  throw new Error(`Selector no encontrado dentro de ${timeout}ms: ${selector}`);
}

/**
 * Espera a que una expresión JS retorne truthy.
 * Equivalente a page.waitForFunction() de Puppeteer.
 */
export async function waitForCondition(
  view: WebView,
  expression: string,
  timeout = 30000
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await view.evaluate(expression);
    if (result) return;
    await new Promise<void>(r => setTimeout(r, 100));
  }
  throw new Error(`Condición no cumplida dentro de ${timeout}ms: ${expression}`);
}

/**
 * Captura screenshot de un elemento específico via CDP clip.
 * Equivalente a element.screenshot() de Puppeteer.
 */
export async function screenshotElement(
  view: WebView,
  selector: string
): Promise<string> {
  const box = await view.evaluate(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    })()
  `) as { x: number; y: number; width: number; height: number } | null;

  if (!box) throw new Error(`Elemento no encontrado: ${selector}`);

  const result = await view.cdp("Page.captureScreenshot", {
    format: "png",
    clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
  }) as { data: string };

  return result.data;
}
