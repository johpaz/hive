/**
 * BrowserService — lanza Chrome/Brave VISIBLE y lo controla via CDP (WebSocket).
 *
 * Flujo:
 *  1. Detecta el browser instalado (nativo o Flatpak).
 *  2. Lo lanza con Bun.spawn + --remote-debugging-port=9222.
 *  3. CDPClient conecta via WebSocket al DevTools endpoint.
 *  4. Todas las herramientas de browser usan CDPClient como si fuera Puppeteer/Playwright.
 */

import { logger } from "../../utils/logger.ts";
import type { Config } from "../../config/loader.ts";
import { existsSync, writeFileSync, chmodSync } from "fs";
import { tmpdir } from "os";

const log = logger.child("browser-service");

// ─── Detección del browser ────────────────────────────────────────────────────

const FLATPAK_BROWSERS = [
  "com.google.Chrome",
  "com.brave.Browser",
  "org.chromium.Chromium",
  "com.microsoft.Edge",
];

const NATIVE_PATHS: Record<string, string[]> = {
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/brave-browser",
    "/usr/bin/brave",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/snap/bin/chromium",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  ],
  win32: [
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ],
};

export type LaunchSpec =
  | { kind: "native"; path: string }
  | { kind: "flatpak"; appId: string };

export function detectBrowser(): LaunchSpec | undefined {
  if (process.env.BUN_CHROME_PATH && existsSync(process.env.BUN_CHROME_PATH)) {
    return { kind: "native", path: process.env.BUN_CHROME_PATH };
  }
  const platform = process.platform as string;
  const natives = (NATIVE_PATHS[platform] ?? NATIVE_PATHS.linux).filter(Boolean);
  const found = natives.find(p => existsSync(p));
  if (found) return { kind: "native", path: found };

  if (platform === "linux" && existsSync("/usr/bin/flatpak")) {
    for (const appId of FLATPAK_BROWSERS) {
      const r = Bun.spawnSync(["flatpak", "info", appId], { stdout: "pipe", stderr: "pipe" });
      if (r.exitCode === 0) return { kind: "flatpak", appId };
    }
  }
}

// ─── CDP Client ───────────────────────────────────────────────────────────────

const CDP_PORT = 9222;
const allInstances = new Set<CDPClient>();

export class CDPClient {
  private ws: WebSocket | null = null;
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private cmdId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private _url = "";
  private _focusedSelector: string | null = null;

  get url(): string { return this._url; }
  get title(): string { return ""; }
  get loading(): boolean { return false; }
  get isConnected(): boolean { return this.ws !== null && this.ws.readyState === WebSocket.OPEN; }

  // ── Launch ──────────────────────────────────────────────────────────────────

  async launch(spec: LaunchSpec): Promise<void> {
    const commonArgs = [
      `--remote-debugging-port=${CDP_PORT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-popup-blocking",
      `--user-data-dir=${tmpdir()}/hive-browser-profile`,
      "about:blank",
    ];

    if (spec.kind === "native") {
      this.proc = Bun.spawn([spec.path, ...commonArgs], {
        stdout: "ignore",
        stderr: "ignore",
      });
      log.info(`Lanzando browser nativo: ${spec.path} (PID ${this.proc.pid})`);
    } else {
      this.proc = Bun.spawn(["flatpak", "run", spec.appId, ...commonArgs], {
        stdout: "ignore",
        stderr: "ignore",
      });
      log.info(`Lanzando Flatpak ${spec.appId} (PID ${this.proc.pid})`);
    }

    await this._waitForCDP();
    await this._connect();
    allInstances.add(this);
  }

  // ── CDP WebSocket ───────────────────────────────────────────────────────────

  private async _waitForCDP(timeout = 15000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`http://localhost:${CDP_PORT}/json/version`);
        if (r.ok) return;
      } catch { /* not ready yet */ }
      await new Promise<void>(r => setTimeout(r, 300));
    }
    throw new Error(`CDP no respondió en ${timeout}ms en puerto ${CDP_PORT}`);
  }

  private async _connect(): Promise<void> {
    const r = await fetch(`http://localhost:${CDP_PORT}/json`);
    const targets = await r.json() as Array<{ type: string; webSocketDebuggerUrl: string }>;
    const target = targets.find(t => t.type === "page") ?? targets[0];
    if (!target?.webSocketDebuggerUrl) throw new Error("No hay target CDP disponible");

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      ws.onopen = () => {
        this.ws = ws;
        ws.onmessage = (ev: MessageEvent) => {
          const msg = JSON.parse(ev.data as string) as {
            id?: number;
            result?: unknown;
            error?: { message: string };
          };
          if (msg.id !== undefined) {
            const p = this.pending.get(msg.id);
            if (p) {
              this.pending.delete(msg.id);
              if (msg.error) p.reject(new Error(msg.error.message));
              else p.resolve(msg.result ?? {});
            }
          }
        };
        resolve();
      };
      ws.onerror = () => reject(new Error("WebSocket CDP falló al conectar"));
      ws.onclose = () => {
        // Rechazar todos los pendientes
        for (const p of this.pending.values()) p.reject(new Error("CDP WebSocket cerrado"));
        this.pending.clear();
      };
    });

    await this.cdp("Page.enable");
    await this.cdp("Runtime.enable");
  }

  // ── CDP raw command ─────────────────────────────────────────────────────────

  async cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws) throw new Error("CDP no conectado");
    const id = ++this.cmdId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: v => resolve(v as T),
        reject,
      });
      this.ws!.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }

  // ── navigate ────────────────────────────────────────────────────────────────

  async navigate(url: string): Promise<void> {
    this._focusedSelector = null;
    await this.cdp("Page.navigate", { url });
    // Esperar hasta document.readyState === 'complete'
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await new Promise<void>(r => setTimeout(r, 150));
      try {
        const res = await this.cdp<{ result: { value: string } }>("Runtime.evaluate", {
          expression: "document.readyState",
          returnByValue: true,
        });
        if (res.result?.value === "complete") break;
      } catch { /* continuar */ }
    }
    // Actualizar URL real (puede haber redirect)
    try {
      const res = await this.cdp<{ result: { value: string } }>("Runtime.evaluate", {
        expression: "location.href",
        returnByValue: true,
      });
      this._url = res.result?.value || url;
    } catch {
      this._url = url;
    }
  }

  // ── evaluate ────────────────────────────────────────────────────────────────

  async evaluate<T = unknown>(script: string): Promise<T> {
    const res = await this.cdp<{ result: { value: T } }>("Runtime.evaluate", {
      expression: `(async () => { return (${script}) })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.value as T;
  }

  // ── screenshot ──────────────────────────────────────────────────────────────

  async screenshot(options?: {
    encoding?: "blob" | "buffer" | "base64" | "shmem";
    format?: "png" | "jpeg" | "webp";
    quality?: number;
    clip?: { x: number; y: number; width: number; height: number; scale: number };
  }): Promise<string> {
    const params: Record<string, unknown> = {
      format: options?.format ?? "png",
    };
    if (options?.quality) params.quality = options.quality;
    if (options?.clip) params.clip = options.clip;

    const res = await this.cdp<{ data: string }>("Page.captureScreenshot", params);
    return res.data;
  }

  // ── click ───────────────────────────────────────────────────────────────────

  async click(selector: string, _options?: Record<string, unknown>): Promise<void> {
    // 1. Verificar que el elemento existe y obtener coordenadas para visual feedback
    const box = await this.evaluate<{ x: number; y: number; width: number; height: number } | null>(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ behavior: "instant", block: "center" });
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), width: r.width, height: r.height };
      })()
    `);
    if (!box) throw new Error(`Selector no encontrado: ${selector}`);

    // 2. Mover el cursor CDP al elemento (visual feedback en el browser visible)
    await this.cdp("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: box.x, y: box.y, button: "none",
    });

    // 3. element.click() para trigger fiable de onclick/event listeners
    await this.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    this._focusedSelector = selector;
  }

  // ── type ────────────────────────────────────────────────────────────────────

  async type(text: string): Promise<void> {
    // Si sabemos qué elemento fue clickeado, escribimos directamente en él.
    // Esto es más fiable que Input.insertText o dispatchKeyEvent char, que
    // dependen de que CDP tenga el focus sincronizado correctamente.
    if (this._focusedSelector) {
      const sel = this._focusedSelector;
      await this.evaluate(`
        (() => {
          const el = document.querySelector(${JSON.stringify(sel)});
          if (!el) return;
          const s = el.selectionStart ?? el.value?.length ?? 0;
          const e = el.selectionEnd ?? el.value?.length ?? 0;
          const before = (el.value ?? "").substring(0, s);
          const after  = (el.value ?? "").substring(e);
          el.value = before + ${JSON.stringify(text)} + after;
          el.selectionStart = el.selectionEnd = before.length + ${JSON.stringify(text)}.length;
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `);
    } else {
      // Fallback: char events al elemento activo del browser
      for (const char of text) {
        await this.cdp("Input.dispatchKeyEvent", { type: "char", text: char });
      }
    }
  }

  // ── press ───────────────────────────────────────────────────────────────────

  async press(key: string, options?: { modifiers?: string[] }): Promise<void> {
    const modifierBits = (options?.modifiers ?? []).reduce((acc, m) => {
      if (m === "Alt") return acc | 1;
      if (m === "Control" || m === "Meta") return acc | 2;
      if (m === "Shift") return acc | 8;
      return acc;
    }, 0);

    await this.cdp("Input.dispatchKeyEvent", { type: "keyDown", key, modifiers: modifierBits });
    // El evento 'char' es necesario para que el navegador procese teclas como Enter
    // y dispare comportamientos del DOM (submit de formularios, saltos de línea, etc.)
    await this.cdp("Input.dispatchKeyEvent", {
      type: "char",
      key: key === "Return" || key === "Enter" ? "\r" : key.length === 1 ? key : "",
      modifiers: modifierBits,
    });
    await this.cdp("Input.dispatchKeyEvent", { type: "keyUp", key, modifiers: modifierBits });
  }

  // ── scroll ──────────────────────────────────────────────────────────────────

  async scroll(dx: number, dy: number): Promise<void> {
    await this.evaluate(`window.scrollBy(${dx}, ${dy})`);
  }

  async scrollTo(selector: string, options?: { behavior?: "smooth" | "instant" }): Promise<void> {
    const behavior = options?.behavior ?? "smooth";
    await this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ behavior: ${JSON.stringify(behavior)}, block: "center" })`);
  }

  // ── navigation helpers ──────────────────────────────────────────────────────

  async back(): Promise<void> {
    await this.evaluate("history.back()");
    await new Promise<void>(r => setTimeout(r, 800));
  }

  async forward(): Promise<void> {
    await this.evaluate("history.forward()");
    await new Promise<void>(r => setTimeout(r, 800));
  }

  async reload(): Promise<void> {
    await this.cdp("Page.reload");
    await new Promise<void>(r => setTimeout(r, 1000));
  }

  async resize(width: number, height: number): Promise<void> {
    await this.cdp("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
  }

  // ── close ───────────────────────────────────────────────────────────────────

  close(): void {
    try { this.ws?.close(); } catch { /* ignore */ }
    try { this.proc?.kill(); } catch { /* ignore */ }
    this.ws = null;
    this.proc = null;
    this._url = "";
    allInstances.delete(this);
  }

  static closeAll(): void {
    for (const inst of allInstances) inst.close();
    allInstances.clear();
  }
}

// ─── BrowserService (singleton) ───────────────────────────────────────────────

export type BrowserView = CDPClient;

let _client: CDPClient | null = null;
let _spec: LaunchSpec | undefined = undefined;
let _available = false;
let _launching = false;

export class BrowserService {
  private static instance: BrowserService | null = null;

  private constructor(_config: Config) {}

  static getInstance(config: Config): BrowserService {
    if (!BrowserService.instance) {
      BrowserService.instance = new BrowserService(config);
    }
    return BrowserService.instance;
  }

  /**
   * Probe-only: detect if a browser is installed and mark tools as available.
   * Does NOT launch the browser — that happens lazily on first tool use.
   */
  async start(): Promise<boolean> {
    _spec = detectBrowser();
    if (!_spec) {
      log.warn("Ningún browser Chromium encontrado.");
      log.warn("  Linux nativo: sudo dnf install chromium");
      log.warn("  Flatpak:      flatpak install flathub com.google.Chrome");
      log.warn("  Manual:       export BUN_CHROME_PATH=/ruta/a/chrome");
      _available = false;
      return false;
    }
    _available = true;
    log.info(`✅ Browser detectado (${_spec.kind === "native" ? _spec.path : _spec.appId}) — se abrirá al primer uso`);
    return true;
  }

  /**
   * Lazy launch: called by getView() on first tool use.
   */
  private async _ensureLaunched(): Promise<boolean> {
    if (_client) return true;
    if (!_spec) return false;
    if (_launching) {
      // Wait up to 10s for concurrent launch to finish
      const deadline = Date.now() + 10000;
      while (_launching && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
      return !!_client;
    }
    _launching = true;
    try {
      _client = new CDPClient();
      await _client.launch(_spec);
      log.info("✅ Browser abierto — el usuario verá las acciones del agente");
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

  async getView(): Promise<CDPClient | null> {
    if (!_available) return null;

    // Health-check: if Chrome was closed by the user or crashed, relaunch on next call
    if (_client && !_client.isConnected) {
      log.warn("Browser connection lost — relaunching on next tool call");
      _client = null;
    }

    await this._ensureLaunched();
    return _client;
  }

  /** Sync version — returns existing client only (no launch). Use getView() in tools. */
  getViewSync(): CDPClient | null {
    return _client;
  }

  async getPage(): Promise<CDPClient | null> {
    return this.getView();
  }

  isAvailable(): boolean {
    return _available;
  }

  isRunning(): boolean {
    return _available && _client !== null;
  }

  getInfo(): { running: boolean } {
    return { running: this.isRunning() };
  }

  async stop(): Promise<void> {
    if (_client) {
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

// ─── Helpers (misma API que antes) ───────────────────────────────────────────

export async function waitForSelector(
  view: CDPClient,
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
  view: CDPClient,
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
  view: CDPClient,
  selector: string
): Promise<string> {
  const box = await view.evaluate<{ x: number; y: number; width: number; height: number } | null>(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    })()
  `);

  if (!box) throw new Error(`Elemento no encontrado: ${selector}`);

  return view.screenshot({
    format: "png",
    clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
  });
}
