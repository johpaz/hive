/**
 * BrowserBackend — el contrato que consumen las browser tools.
 *
 * Hay una sola implementación: `WebViewBackend` (webview-backend.ts), sobre
 * `Bun.WebView`. In-process, sin instalación y sin subprocesos: ~0,3 ms un
 * `evaluate`, ~2 ms un `snapshot`. Con motor chrome corre headless de verdad
 * —Bun lanza el navegador con `--headless`—, así que sirve en un servidor sin
 * display; lo único que necesita es un navegador Chromium instalado (o
 * `BUN_CHROME_PATH`).
 *
 * El contrato sigue existiendo aunque el backend sea uno solo: es lo que hace
 * que las tools no dependan del motor, y lo que deja al motor WebKit de macOS
 * —que no tiene CDP— entrar por la misma puerta con menos capacidades.
 *
 * Dos cosas que hay que saber del WebView y que están resueltas adentro: el
 * perfil de Chrome que abre Bun es efímero (`/tmp/.<hash>.bun-chrome`, y el
 * hash cambia entre procesos), por eso las cookies se guardan y restauran a
 * mano desde `browser-session.ts`; y como root sin `--no-sandbox` Chromium no
 * arranca, por eso el Dockerfile apunta `BUN_CHROME_PATH` a un wrapper.
 */

import { logger } from "../../utils/logger.ts";

const log = logger.child("browser-backend");

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
  /**
   * Puente CDP crudo. Opcional a propósito: lo tienen los backends con Chrome,
   * no el motor WebKit de macOS. Quien lo use tiene que traer una alternativa.
   */
  cdp?<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): void;
}

/** Ya no hay más de uno; el tipo se conserva porque lo reportan doctor y el gateway. */
export type BrowserBackendKind = "webview";

/**
 * Lo que se puede pedir por config. `"agent-browser"` era el backend por CLI que
 * se retiró: se sigue aceptando para no romper un `hive.json` viejo, pero avisa
 * y usa el WebView.
 */
export type BrowserBackendPreference = BrowserBackendKind | "auto" | "agent-browser";

/** Motor que usa `Bun.WebView` por debajo. */
export type WebViewEngine = "webkit" | "chrome";

/**
 * Binarios que valen: cualquier Chromium sirve, porque lo que Bun necesita es
 * `--remote-debugging-pipe`, que todos implementan. Edge y Brave son los que más
 * aparecen en máquinas donde no hay Chrome "de marca".
 */
const CHROME_BINARIES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "brave-browser",
  "microsoft-edge",
  "microsoft-edge-stable",
  "vivaldi",
  "vivaldi-stable",
  "opera",
];

/** Rutas conocidas por plataforma, en orden de preferencia. */
function chromePathsForPlatform(): string[] {
  const home = process.env.HOME ?? "";

  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
      `${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ];
  }

  if (process.platform === "win32") {
    const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA ?? "";
    return [
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${programFiles}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    ];
  }

  // Linux: paquetes del sistema, snap y los wrappers que exporta flatpak —que
  // en la práctica son el único Chrome de muchas máquinas.
  const flatpakDirs = ["/var/lib/flatpak/exports/bin", `${home}/.local/share/flatpak/exports/bin`];
  const flatpakApps = ["com.google.Chrome", "org.chromium.Chromium", "com.brave.Browser", "com.microsoft.Edge"];
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/brave-browser",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/vivaldi",
    "/usr/bin/opera",
    "/snap/bin/chromium",
    "/snap/bin/brave",
    ...flatpakDirs.flatMap((dir) => flatpakApps.map((app) => `${dir}/${app}`)),
  ];
}

/** Navegador instalado — `Bun.WebView` con motor chrome lo necesita. */
export function findChrome(): string | null {
  if (process.env.BUN_CHROME_PATH) return process.env.BUN_CHROME_PATH;

  const { existsSync } = require("node:fs") as typeof import("node:fs");
  for (const candidate of chromePathsForPlatform()) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  // Último recurso: lo que haya en el PATH, que cubre instalaciones a mano y
  // los wrappers que el usuario tenga en ~/.local/bin.
  const which = (globalThis as { Bun?: { which?: (cmd: string) => string | null } }).Bun?.which;
  if (which) {
    for (const name of CHROME_BINARIES) {
      const found = which(name);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Motor a usar.
 *
 * Chrome primero **también en macOS**: es el único que trae CDP, y de CDP
 * dependen el árbol de accesibilidad del snapshot, la sesión persistente y los
 * clics reales de `computer_use_task`. WebKit queda como respaldo para un mac
 * sin ningún Chromium instalado: no necesita nada, pero da menos.
 */
export function resolveWebViewEngine(): WebViewEngine | null {
  if (findChrome()) return "chrome";
  return process.platform === "darwin" ? "webkit" : null;
}

/** `Bun.WebView` existe desde Bun 1.3; además hace falta un motor utilizable. */
export function isWebViewSupported(): boolean {
  if (typeof (globalThis as { Bun?: { WebView?: unknown } }).Bun?.WebView !== "function") return false;
  return resolveWebViewEngine() !== null;
}

/**
 * Qué decirle a alguien que no tiene navegador. Lo usan el arranque del gateway
 * y `hive doctor`, para que el mensaje sea el mismo en los dos lados.
 */
export function browserInstallHint(): string {
  if (process.platform === "darwin") {
    return "Instala Google Chrome (brew install --cask google-chrome) o define BUN_CHROME_PATH.";
  }
  if (process.platform === "win32") {
    return "Instala Google Chrome o Microsoft Edge, o define BUN_CHROME_PATH.";
  }
  return "Instala Chromium o Chrome (apt install chromium · dnf install chromium) o define BUN_CHROME_PATH.";
}

let avisoBackendRetirado = false;

export function resolveBackendKind(
  preference: BrowserBackendPreference | undefined,
): BrowserBackendKind {
  const wanted = process.env.HIVE_BROWSER_BACKEND ?? preference;
  if (wanted === "agent-browser" && !avisoBackendRetirado) {
    avisoBackendRetirado = true;
    log.warn(
      'tools.browser.backend: "agent-browser" ya no existe — se usa Bun.WebView. ' +
        "Puedes quitar esa clave de la config.",
    );
  }
  return "webview";
}
