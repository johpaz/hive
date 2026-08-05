/**
 * BrowserBackend — el contrato que consumen las browser tools.
 *
 * Hay dos implementaciones con perfiles opuestos:
 *
 *  - `AgentBrowserBackend` (browser-service.ts): habla con el CLI de
 *    agent-browser por subproceso. Maneja Chrome de verdad, corre headless y
 *    por lo tanto sirve en Docker y en un servidor sin display. El costo es
 *    un `Bun.spawn` por operación —medido en ~68 ms de piso— más una
 *    instalación diferida de ~75 MB y la descarga de Chrome.
 *
 *  - `WebViewBackend` (webview-backend.ts): usa `Bun.WebView`, in-process.
 *    Sin instalación, sin subprocesos, ~0.25 ms por `evaluate`. Necesita un
 *    entorno gráfico (WebKitGTK en Linux, WebKit del sistema en macOS), así
 *    que no sirve headless.
 *
 * El default sigue siendo agent-browser: es el único de los dos que funciona
 * donde suele correr el gateway. WebView se elige explícitamente.
 */

export interface ScreenshotOptions {
  encoding?: "blob" | "buffer" | "base64" | "shmem";
  format?: "png" | "jpeg" | "webp";
  quality?: number;
  clip?: { x: number; y: number; width: number; height: number; scale: number };
}

export interface SnapshotOptions {
  /** Colapsa nodos sin nombre accesible y recorta el texto largo. Default: true. */
  compact?: boolean;
  /** Profundidad máxima del árbol. */
  depth?: number;
  /** Sólo elementos accionables (links, botones, inputs...). */
  interactiveOnly?: boolean;
}

/**
 * La superficie que las tools de `tools/web/` realmente usan. Se mantuvo
 * deliberadamente chica: cualquier método que se agregue acá hay que
 * implementarlo en los dos backends.
 */
export interface BrowserBackend {
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;

  navigate(url: string): Promise<void>;
  evaluate<T = unknown>(script: string): Promise<T>;
  screenshot(options?: ScreenshotOptions): Promise<string>;
  /** Árbol de accesibilidad en texto — lo que ve el modelo en vez del HTML crudo. */
  snapshot(options?: SnapshotOptions): Promise<string>;
  click(selector: string, options?: Record<string, unknown>): Promise<void>;
  type(text: string): Promise<void>;
  typeIn(selector: string, text: string): Promise<void>;
  fill(selector: string, text: string): Promise<void>;
  press(key: string, options?: { modifiers?: string[] }): Promise<void>;
  scroll(dx: number, dy: number): Promise<void>;
  scrollTo(selector: string, options?: { behavior?: "smooth" | "instant" }): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;
  resize(width: number, height: number): Promise<void>;
  /** Captura de un elemento puntual; el backend puede recortar sobre el viewport. */
  screenshotElement(selector: string): Promise<string>;
  close(): void;
}

export type BrowserBackendKind = "agent-browser" | "webview";

/** `auto` resuelve a webview si el runtime lo soporta; si no, agent-browser. */
export type BrowserBackendPreference = BrowserBackendKind | "auto";

/** Motor que usa `Bun.WebView` por debajo. */
export type WebViewEngine = "webkit" | "chrome";

const CHROME_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

/** Chrome instalado en el sistema — `Bun.WebView` con motor chrome lo necesita. */
export function findChrome(): string | null {
  if (process.env.BUN_CHROME_PATH) return process.env.BUN_CHROME_PATH;
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  for (const candidate of CHROME_PATHS) {
    if (existsSync(candidate)) return candidate;
  }
  // Último recurso: lo que esté en el PATH del usuario.
  const home = process.env.HOME;
  if (home) {
    for (const name of ["google-chrome", "chromium"]) {
      const local = `${home}/.local/bin/${name}`;
      if (existsSync(local)) return local;
    }
  }
  return null;
}

/**
 * Motor a usar. WebKit no tiene dependencias externas pero sólo existe en macOS;
 * Chrome corre headless en cualquier lado —incluido Docker— siempre que el
 * binario esté instalado.
 */
export function resolveWebViewEngine(): WebViewEngine | null {
  if (process.platform === "darwin") return "webkit";
  return findChrome() ? "chrome" : null;
}

/** `Bun.WebView` existe desde Bun 1.3; además hace falta un motor utilizable. */
export function isWebViewSupported(): boolean {
  if (typeof (globalThis as { Bun?: { WebView?: unknown } }).Bun?.WebView !== "function") return false;
  return resolveWebViewEngine() !== null;
}

export function resolveBackendKind(
  preference: BrowserBackendPreference | undefined,
): BrowserBackendKind {
  const wanted = process.env.HIVE_BROWSER_BACKEND ?? preference ?? "agent-browser";
  if (wanted === "webview") return "webview";
  if (wanted === "auto") return isWebViewSupported() ? "webview" : "agent-browser";
  return "agent-browser";
}
