/**
 * BrowserService — automatización de navegador, con backend intercambiable.
 *
 * `AgentBrowserBackend` (este archivo) habla con el CLI de agent-browser por
 * subproceso: maneja Chrome de verdad y corre headless, así que es el único que
 * sirve en Docker o en un servidor sin display. Por eso sigue siendo el default.
 *
 * `WebViewBackend` (webview-backend.ts) usa `Bun.WebView` in-process — sin
 * instalación ni subprocesos, mucho más rápido — pero necesita entorno gráfico.
 * Se elige con `tools.browser.backend` o `HIVE_BROWSER_BACKEND`.
 *
 * Flujo del backend por CLI:
 *  1. Detecta si agent-browser está instalado (lazy install en primer uso).
 *  2. Ejecuta comandos via CLI con --json para output estructurado.
 *  3. El daemon de agent-browser maneja Chrome internamente via CDP.
 */

import { logger } from "../../utils/logger.ts";
import type { Config } from "../../config/loader.ts";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { homedir, tmpdir } from "os";
import { dirname, join, resolve } from "path";
import {
  resolveBackendKind,
  type BrowserBackend,
  type BrowserBackendKind,
  type ScreenshotOptions,
  type SnapshotOptions,
} from "./browser-backend.ts";

const log = logger.child("browser-service");

// ─── Instalación lazy de agent-browser ────────────────────────────────────────

const HIVE_DIR = join(homedir(), ".hive");
const AGENT_BROWSER_DIR = join(HIVE_DIR, "agent-browser");
const AGENT_BROWSER_PKG_JSON = join(AGENT_BROWSER_DIR, "package.json");
const DEFAULT_SESSION_NAME = "hive";

/** Check if agent-browser is installed in the cache dir by running --version */
async function isAgentBrowserInstalled(): Promise<boolean> {
  if (!existsSync(AGENT_BROWSER_PKG_JSON)) return false;
  try {
    const proc = Bun.spawn(["bun", "run", "agent-browser", "--version"], {
      cwd: AGENT_BROWSER_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function installAgentBrowser(): Promise<void> {
  mkdirSync(AGENT_BROWSER_DIR, { recursive: true });

  // Create minimal package.json
  const pkg = { name: "hive-agent-browser", version: "1.0.0", dependencies: {} };
  await Bun.write(AGENT_BROWSER_PKG_JSON, JSON.stringify(pkg, null, 2));

  log.info("📦 Instalando agent-browser (primera vez, ~75MB)...");
  const proc = Bun.spawn(["bun", "add", "agent-browser@latest"], {
    cwd: AGENT_BROWSER_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  const stderr = await new Response(proc.stderr).text();

  if (exitCode !== 0) {
    throw new Error(`bun add agent-browser failed: ${stderr}`);
  }

  log.info("✅ agent-browser instalado.");
}

/** Run agent-browser CLI from the cache directory — cross-platform via bun run */
async function runAgentBrowser(
  args: string[]
): Promise<{ success: boolean; data?: any; error?: string }> {
  const proc = Bun.spawn(["bun", "run", "agent-browser", ...args], {
    cwd: AGENT_BROWSER_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0 && !stdout.trim()) {
    throw new Error(stderr || `agent-browser ${args[0]} failed`);
  }

  try {
    const result = JSON.parse(stdout.trim().split("\n").pop() || "{}");
    return result;
  } catch {
    return { success: true, data: { raw: stdout.trim() } };
  }
}

async function ensureChromeInstalled(): Promise<void> {
  log.info("🔍 Verificando Chrome para agent-browser...");
  const res = await runAgentBrowser(["open", "about:blank", "--session", DEFAULT_SESSION_NAME, "--json"]);

  if (!res.success) {
    const err = res.error || "";
    // Chrome not installed — trigger install
    if (err.includes("not found") || err.includes("install")) {
      log.info("📥 Descargando Chrome (agent-browser install)...");
      const installProc = Bun.spawn(["bun", "run", "agent-browser", "install"], {
        cwd: AGENT_BROWSER_DIR,
        stdout: "pipe",
        stderr: "pipe",
      });
      const installExit = await installProc.exited;
      if (installExit !== 0) {
        const installErr = await new Response(installProc.stderr).text();
        throw new Error(`agent-browser install failed: ${installErr}`);
      }
      log.info("✅ Chrome descargado.");
      return;
    }
    throw new Error(`agent-browser chrome check failed: ${err}`);
  }
}

// ─── AgentBrowserView (API compatible con CDPClient) ──────────────────────────

export class AgentBrowserView implements BrowserBackend {
  private sessionName: string;
  private _url = "";

  get url(): string { return this._url; }
  get title(): string { return ""; }
  get loading(): boolean { return false; }
  get isConnected(): boolean { return true; }

  constructor(sessionName: string = DEFAULT_SESSION_NAME) {
    this.sessionName = sessionName;
  }

  protected async run(args: string[]): Promise<{ success: boolean; data?: any; error?: string }> {
    return runAgentBrowser(["--session", this.sessionName, "--json", ...args]);
  }

  async navigate(url: string): Promise<void> {
    // Ensure protocol
    const target = /^https?:\/\//.test(url) ? url : `https://${url}`;
    const res = await this.run(["open", target]);
    if (!res.success) throw new Error(res.error || "navigate failed");
    this._url = res.data?.url || target;
    // Small delay to let JS settle (same as old implementation)
    await new Promise(r => setTimeout(r, 500));
  }

  async evaluate<T = unknown>(script: string): Promise<T> {
    let wrapped = script;
    const trimmed = script.trim();

    // If script contains top-level await, wrap in async IIFE to make it valid JS
    if (/\bawait\b/.test(script) && !trimmed.startsWith("(async") && !trimmed.startsWith("async function")) {
      if (trimmed.startsWith("return")) {
        wrapped = `(async () => { ${script} })()`;
      } else {
        wrapped = `(async () => { return ${script}; })()`;
      }
    }

    const res = await this.run(["eval", wrapped]);
    if (!res.success) throw new Error(res.error || "eval failed");
    return res.data?.result as T;
  }

  async screenshot(options?: ScreenshotOptions): Promise<string> {
    // Build args
    const args: string[] = ["screenshot"];

    if (options?.format === "jpeg") {
      args.push("--screenshot-format", "jpeg");
    }
    if (options?.quality) {
      args.push("--screenshot-quality", String(options.quality));
    }

    // If clip/selector is provided, agent-browser screenshot accepts a positional selector
    // For element screenshots, we can pass a selector as first positional arg
    // But we don't have selector in options here — the old CDPClient didn't use it either
    // screenshotElement helper handles element-specific screenshots

    const res = await this.run(args);
    if (!res.success) throw new Error(res.error || "screenshot failed");

    const path = res.data?.path as string;
    if (!path) throw new Error("screenshot did not return a path");

    const data = readFileSync(path);
    const base64 = Buffer.from(data).toString("base64");

    // Cleanup temp file
    try { rmSync(path); } catch { /* ignore */ }

    return base64;
  }

  async click(selector: string, _options?: Record<string, unknown>): Promise<void> {
    const res = await this.run(["click", selector]);
    if (!res.success) throw new Error(res.error || `click failed: ${selector}`);
  }

  async type(text: string): Promise<void> {
    // Fallback: keyboard inserttext (requires focused element)
    const res = await this.run(["keyboard", "inserttext", text]);
    if (!res.success) throw new Error(res.error || "type failed");
  }

  async typeIn(selector: string, text: string): Promise<void> {
    const res = await this.run(["type", selector, text]);
    if (!res.success) throw new Error(res.error || `type failed: ${selector}`);
  }

  async fill(selector: string, text: string): Promise<void> {
    const res = await this.run(["fill", selector, text]);
    if (!res.success) throw new Error(res.error || `fill failed: ${selector}`);
  }

  async press(key: string, options?: { modifiers?: string[] }): Promise<void> {
    const modifiers = options?.modifiers ?? [];
    const combo = modifiers.length > 0
      ? `${modifiers.join("+")}+${key}`
      : key;
    const res = await this.run(["press", combo]);
    if (!res.success) throw new Error(res.error || `press failed: ${combo}`);
  }

  async scroll(dx: number, dy: number): Promise<void> {
    const dir = dy > 0 ? "down" : dy < 0 ? "up" : dx > 0 ? "right" : "left";
    const px = Math.abs(dy || dx);
    const res = await this.run(["scroll", dir, String(px)]);
    if (!res.success) throw new Error(res.error || "scroll failed");
  }

  async scrollTo(selector: string, _options?: { behavior?: "smooth" | "instant" }): Promise<void> {
    // agent-browser has scrollintoview (behavior not supported via CLI)
    const res = await this.run(["scrollintoview", selector]);
    if (!res.success) throw new Error(res.error || `scrollTo failed: ${selector}`);
  }

  async back(): Promise<void> {
    const res = await this.run(["back"]);
    if (!res.success) throw new Error(res.error || "back failed");
    await new Promise<void>(r => setTimeout(r, 800));
  }

  async forward(): Promise<void> {
    const res = await this.run(["forward"]);
    if (!res.success) throw new Error(res.error || "forward failed");
    await new Promise<void>(r => setTimeout(r, 800));
  }

  async reload(): Promise<void> {
    const res = await this.run(["reload"]);
    if (!res.success) throw new Error(res.error || "reload failed");
    await new Promise<void>(r => setTimeout(r, 1000));
  }

  async resize(width: number, height: number): Promise<void> {
    const res = await this.run(["set", "viewport", String(width), String(height)]);
    if (!res.success) throw new Error(res.error || "resize failed");
  }

  /** Screenshot recortado a un elemento — agent-browser acepta el selector posicional. */
  async screenshotElement(selector: string): Promise<string> {
    const res = await this.run(["screenshot", selector]);
    if (!res.success) throw new Error(res.error || `screenshot failed: ${selector}`);

    const path = res.data?.path as string;
    if (!path) throw new Error("screenshot did not return a path");

    const base64 = Buffer.from(readFileSync(path)).toString("base64");
    try { rmSync(path); } catch { /* ignore */ }
    return base64;
  }

  /** Capture accessibility tree snapshot (compact, AI-optimized). ~200-600 chars vs ~3000+ innerText. */
  async snapshot(options?: SnapshotOptions): Promise<string> {
    const args = ["snapshot"];
    if (options?.compact !== false) args.push("-c");
    if (options?.depth) args.push("-d", String(options.depth));
    if (options?.interactiveOnly) args.push("-i");

    const res = await this.run(args);
    if (!res.success) throw new Error(res.error || "snapshot failed");
    return res.data?.snapshot as string || "";
  }

  async cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const script = `
      (() => {
        // agent-browser does not expose raw CDP directly via CLI for all methods.
        // For common methods we can emulate; for others we return a notice.
        const method = ${JSON.stringify(method)};
        const params = ${JSON.stringify(params ?? {})};
        return { method, params, note: "CDP passthrough not fully supported by agent-browser CLI" };
      })()
    `;
    const res = await this.run(["eval", script]);
    if (!res.success) throw new Error(res.error || `cdp failed: ${method}`);
    return res.data?.result as T;
  }

  close(): void {
    // Close the session
    this.run(["close"]).catch(() => { /* ignore */ });
  }
}

// ─── Backwards compatibility exports ──────────────────────────────────────────

/** @deprecated Use AgentBrowserView instead */
export class CDPClient extends AgentBrowserView {
  private _launched = false;

  async launch(_spec?: unknown, _options?: unknown): Promise<void> {
    if (this._launched) return;
    // Verify agent-browser is working by opening about:blank
    const res = await this.run(["open", "about:blank"]);
    if (!res.success) throw new Error(res.error || "Failed to launch agent-browser");
    this._launched = true;
  }

  static closeAll(): void {
    // agent-browser sessions are managed by the daemon; no explicit cleanup needed
  }
}

/** @deprecated No longer used — agent-browser handles browser detection internally */
export function detectBrowser(_options?: unknown): undefined {
  return undefined;
}

/** @deprecated No longer used */
export type LaunchSpec = { kind: "remote"; cdpUrl: string };

// ─── BrowserService (singleton) ───────────────────────────────────────────────

/** Alias histórico: las tools sólo dependen del contrato, no de la implementación. */
export type BrowserView = BrowserBackend;

/** Re-export para que quien importe el servicio no tenga que conocer el módulo del contrato. */
export type { BrowserBackend, BrowserBackendKind } from "./browser-backend.ts";
export { isWebViewSupported, resolveBackendKind } from "./browser-backend.ts";

let _client: BrowserBackend | null = null;
let _available = false;
let _launching = false;
let _kind: BrowserBackendKind = "agent-browser";

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
   * Probe / lazy install agent-browser.
   */
  async start(): Promise<boolean> {
    const b = this.config.tools?.browser;
    if (b?.enabled === false) {
      _available = false;
      return false;
    }

    _kind = resolveBackendKind(b?.backend);

    if (_kind === "webview") {
      // No hay nada que instalar ni que descargar: el WebView se crea al primer
      // uso. Si el entorno no lo soporta, ensureView() falla ahí y el servicio
      // queda no disponible, igual que cuando agent-browser no arranca.
      _available = true;
      log.info("✅ Backend de navegador: Bun.WebView (in-process, sin Chrome)");
      return true;
    }

    const installed = await isAgentBrowserInstalled();

    if (!installed) {
      try {
        await installAgentBrowser();
      } catch (err) {
        log.warn(`No se pudo instalar agent-browser: ${(err as Error).message}`);
        log.warn("  Instalar manualmente: bun add -g agent-browser");
        _available = false;
        return false;
      }
    }

    try {
      await ensureChromeInstalled();
    } catch (err) {
      log.warn(`Chrome no pudo prepararse: ${(err as Error).message}`);
      _available = false;
      return false;
    }

    _available = true;
    log.info("✅ agent-browser listo — se abrirá al primer uso");
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
      if (_kind === "webview") {
        const { WebViewBackend } = await import("./webview-backend.ts");
        _client = new WebViewBackend({ show: this.config.tools?.browser?.headless === false });
      } else {
        const sessionName = this.config.tools?.browser?.sessionName ?? DEFAULT_SESSION_NAME;
        _client = new AgentBrowserView(sessionName);
      }
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
  // Antes esto hacía `(view as any).run([...])`, atándose a la implementación por
  // CLI: con dos backends el recorte es responsabilidad de cada uno.
  return view.screenshotElement(selector);
}
