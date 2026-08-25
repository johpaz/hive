/**
 * BrowserService — el navegador que usan las tools de `tools/web/`.
 *
 * Hay un solo backend: `WebViewBackend` (webview-backend.ts), que es
 * `Bun.WebView` in-process. No se instala nada ni se descarga nada; lo único
 * que pide es un navegador Chromium en el sistema (o `BUN_CHROME_PATH`), y con
 * ese motor corre headless, así que sirve igual en un escritorio que en un
 * servidor sin display.
 *
 * Acá vivió un segundo backend por CLI (agent-browser) mientras se creyó que el
 * WebView necesitaba entorno gráfico. Medido en Bun 1.4 no era cierto, y lo que
 * quedaba era el costo: ~40 ms de `Bun.spawn` por operación contra ~0,3 ms, un
 * `bun add agent-browser@latest` ejecutado en producción al primer uso —versión
 * flotante, bajada de npm— y ~88 MB más su propia copia de Chrome. Se retiró.
 *
 * El servicio es un singleton con una sola vista: `getView()` la abre al primer
 * uso y la reutiliza, para que `browser_navigate` establezca el contexto sobre
 * el que operan las tools siguientes.
 */

import { logger } from "../../utils/logger.ts";
import type { Config } from "../../config/loader.ts";
import { resolveBackendKind, type BrowserBackend, type BrowserBackendKind } from "./browser-backend.ts";

const log = logger.child("browser-service");

/** Alias histórico: las tools sólo dependen del contrato, no de la implementación. */
export type BrowserView = BrowserBackend;

/** Re-export para que quien importe el servicio no tenga que conocer el módulo del contrato. */
export type { BrowserBackend, BrowserBackendKind } from "./browser-backend.ts";
export { isWebViewSupported, resolveBackendKind, findChrome } from "./browser-backend.ts";

let _client: BrowserBackend | null = null;
let _available = false;
let _launching = false;
let _kind: BrowserBackendKind = "webview";

export class BrowserService {
  private static instance: BrowserService | null = null;
  private readonly config: Config;

  private constructor(config: Config) {
    this.config = config;
  }

  static getInstance(config: Config): BrowserService {
    if (!BrowserService.instance) {
      BrowserService.instance = new BrowserService(config);
    }
    return BrowserService.instance;
  }

  /**
   * Deja el servicio listo. No abre el navegador: eso pasa en el primer uso.
   *
   * Si el entorno no tiene motor, `ensureView()` falla ahí con un mensaje que
   * dice qué instalar, y las tools reportan el navegador como no disponible.
   */
  async start(): Promise<boolean> {
    const b = this.config.tools?.browser;
    if (b?.enabled === false) {
      _available = false;
      return false;
    }

    _kind = resolveBackendKind(b?.backend);
    _available = true;
    log.info("✅ Navegador: Bun.WebView (in-process, headless)");
    return true;
  }

  private async _ensureLaunched(): Promise<boolean> {
    if (_client) return true;
    if (_launching) {
      const deadline = Date.now() + 10000;
      while (_launching && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
      return !!_client;
    }
    _launching = true;
    try {
      const { WebViewBackend } = await import("./webview-backend.ts");
      // Headless salvo que se pida lo contrario con `tools.browser.headless: false`.
      const visible = this.config.tools?.browser?.headless === false;
      _client = new WebViewBackend({
        show: visible,
        persistSession: this.config.tools?.browser?.persistSession,
      });

      log.info(`✅ Browser abierto (${visible ? "con ventana" : "headless"})`);
      return true;
    } catch (err) {
      log.warn(`Browser no pudo iniciarse: ${(err as Error).message}`);
      _client = null;
      _available = false;
      return false;
    } finally {
      _launching = false;
    }
  }

  async getView(): Promise<BrowserBackend | null> {
    if (!_available) return null;
    await this._ensureLaunched();
    return _client;
  }

  getViewSync(): BrowserBackend | null {
    return _client;
  }

  async getPage(): Promise<BrowserBackend | null> {
    return this.getView();
  }

  /** Qué backend quedó activo — lo reporta `hive doctor` y los tests. */
  getBackendKind(): BrowserBackendKind {
    return _kind;
  }

  isAvailable(): boolean {
    return _available;
  }

  isRunning(): boolean {
    return _available && _client !== null;
  }

  getInfo(): { running: boolean; backend: BrowserBackendKind } {
    return { running: this.isRunning(), backend: _kind };
  }

  async stop(): Promise<void> {
    if (_client) {
      // El volcado de cookies está debounceado: si se cierra antes de que
      // dispare, el login de esta sesión se pierde. Por eso se fuerza acá.
      const flushable = _client as BrowserBackend & { flushSession?: () => Promise<void> };
      if (typeof flushable.flushSession === "function") {
        await flushable.flushSession().catch((err: Error) => {
          log.warn(`no se pudo guardar la sesión al cerrar: ${err.message}`);
        });
      }
      _client.close();
      _client = null;
      log.info("✅ Browser cerrado");
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
 * Cierra todo lo que este proceso haya abierto, pase lo que pase.
 *
 * `stop()` es el camino ordenado —vuelca la sesión antes de cerrar— y esto es
 * la red debajo: `Bun.WebView.closeAll()` mata cualquier vista que haya quedado
 * viva, incluida alguna abierta fuera del servicio. El apagado del gateway
 * llama a esto; antes llamaba a un `CDPClient.closeAll()` que no hacía nada, y
 * por eso Chrome sobrevivía al gateway y la sesión no se guardaba nunca.
 */
export async function shutdownBrowser(): Promise<void> {
  try {
    await browserServiceInstance?.stop();
  } catch (err) {
    log.warn(`cierre del navegador incompleto: ${(err as Error).message}`);
  }
  try {
    (globalThis as { Bun?: { WebView?: { closeAll?: () => void } } }).Bun?.WebView?.closeAll?.();
  } catch {
    /* no hay vistas que cerrar */
  }
}

// ─── Helpers (misma API que antes) ───────────────────────────────────────────

export async function waitForSelector(
  view: BrowserBackend,
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

export async function waitForCondition(
  view: BrowserBackend,
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

export async function screenshotElement(
  view: BrowserBackend,
  selector: string
): Promise<string> {
  // El recorte es responsabilidad del backend: sabe si puede pedirlo por CDP o
  // si tiene que resolverlo sobre el viewport.
  return view.screenshotElement(selector);
}
