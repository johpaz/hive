/**
 * WebViewBackend — `BrowserBackend` sobre `Bun.WebView` (Bun >= 1.3).
 *
 * Corre in-process: no hay subproceso, ni instalación de ~75 MB, ni descarga de
 * Chrome. Un `evaluate` cuesta ~0.25 ms contra los ~68 ms de piso que tiene cada
 * invocación del CLI de agent-browser. A cambio necesita entorno gráfico, así
 * que no reemplaza a agent-browser en Docker ni en un servidor headless.
 *
 * Dos restricciones del motor mandan sobre el diseño de este archivo:
 *
 *  1. `Bun.WebView` acepta **una sola operación pendiente por vez**; dos
 *     llamadas solapadas fallan con `ERR_INVALID_STATE: a simple operation is
 *     already pending`. Todo pasa por una cola serializada.
 *  2. No expone árbol de accesibilidad. `snapshot()` se sintetiza recorriendo
 *     el DOM, imitando el formato que emite agent-browser para que el modelo
 *     vea lo mismo con cualquiera de los dos backends.
 */

import { logger } from "../../utils/logger.ts";
import { resolveWebViewEngine, type BrowserBackend, type ScreenshotOptions, type SnapshotOptions, type WebViewEngine } from "./browser-backend.ts";

const log = logger.child("webview-backend");

/** Tope del texto del snapshot: un DOM grande no puede comerse el contexto. */
const SNAPSHOT_CHAR_LIMIT = 20_000;

/**
 * Forma real de `Bun.WebView` en 1.3.14, verificada contra el prototipo.
 *
 * No se usan los tipos de `bun-types` a propósito: declaran `back()`/`forward()`
 * y el runtime expone `goBack()`/`goForward()`. Contra los tipos, la navegación
 * hacia atrás compila y explota en ejecución.
 */
interface BunWebView {
  navigate(url: string): Promise<void>;
  evaluate(script: string): Promise<unknown>;
  screenshot(): Promise<Blob>;
  cdp(method: string, params?: Record<string, unknown>): Promise<unknown>;
  click(selector: string): Promise<void>;
  type(text: string): Promise<void>;
  press(key: string, modifiers?: Record<string, boolean>): Promise<void>;
  scroll(dx: number, dy: number): Promise<void>;
  scrollTo(selector: string): Promise<void>;
  resize(width: number, height: number): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  reload(): Promise<void>;
  close(): void;
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
}

/**
 * El script que sintetiza el árbol de accesibilidad. Se inyecta como texto, así
 * que no puede cerrar sobre nada del scope de TypeScript: los parámetros entran
 * interpolados como literales JSON.
 */
function buildSnapshotScript(options: Required<SnapshotOptions>): string {
  return `(() => {
  const MAX_DEPTH = ${JSON.stringify(options.depth)};
  const COMPACT = ${JSON.stringify(options.compact)};
  const INTERACTIVE_ONLY = ${JSON.stringify(options.interactiveOnly)};
  const LIMIT = ${SNAPSHOT_CHAR_LIMIT};

  const ROLE_BY_TAG = {
    A: "link", BUTTON: "button", P: "paragraph", IMG: "img", TEXTAREA: "textbox",
    SELECT: "combobox", OPTION: "option", UL: "list", OL: "list", LI: "listitem",
    TABLE: "table", TR: "row", TD: "cell", TH: "columnheader", FORM: "form",
    NAV: "navigation", MAIN: "main", HEADER: "banner", FOOTER: "contentinfo",
    ASIDE: "complementary", LABEL: "label", ARTICLE: "article", SECTION: "region",
    DIALOG: "dialog", SUMMARY: "button", IFRAME: "iframe", VIDEO: "video", AUDIO: "audio",
  };
  const INTERACTIVE = new Set(["link", "button", "textbox", "checkbox", "radio", "combobox", "option", "searchbox"]);
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK", "TITLE", "SVG", "PATH"]);

  function inputRole(el) {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "search") return "searchbox";
    if (type === "button" || type === "submit" || type === "reset" || type === "image") return "button";
    if (type === "hidden") return null;
    return "textbox";
  }

  function roleOf(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.trim().split(/\\s+/)[0];
    if (el.tagName === "INPUT") return inputRole(el);
    if (/^H[1-6]$/.test(el.tagName)) return "heading";
    if (el.tagName === "A") return el.hasAttribute("href") ? "link" : null;
    return ROLE_BY_TAG[el.tagName] || null;
  }

  function ownText(el) {
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 3) text += node.nodeValue;
      // Los inline sin rol propio son parte del nombre del padre, no nodos aparte.
      else if (node.nodeType === 1 && !roleOf(node) && node.childElementCount === 0) {
        text += node.textContent || "";
      }
    }
    return text.replace(/\\s+/g, " ").trim();
  }

  function nameOf(el) {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy.split(/\\s+/)
        .map((id) => { const target = document.getElementById(id); return target ? (target.textContent || "").trim() : ""; })
        .filter(Boolean);
      if (parts.length) return parts.join(" ").replace(/\\s+/g, " ");
    }

    if (el.tagName === "IMG") return (el.getAttribute("alt") || "").trim();
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "button" || type === "submit" || type === "reset") return (el.value || "").trim();
      const placeholder = (el.getAttribute("placeholder") || "").trim();
      if (placeholder) return placeholder;
      if (el.labels && el.labels.length) return (el.labels[0].textContent || "").replace(/\\s+/g, " ").trim();
      return (el.getAttribute("name") || "").trim();
    }

    const own = ownText(el);
    if (own) return own;
    return (el.getAttribute("title") || "").trim();
  }

  function visible(el) {
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return true;
  }

  function attrsOf(el, role) {
    const attrs = [];
    if (role === "heading") attrs.push("level=" + el.tagName.slice(1));
    if (el.disabled) attrs.push("disabled");
    if (el.checked) attrs.push("checked");
    if (el.getAttribute("aria-expanded")) attrs.push("expanded=" + el.getAttribute("aria-expanded"));
    return attrs;
  }

  const lines = [];
  let refSeq = 0;
  let truncated = false;

  function walk(el, depth) {
    if (truncated) return;
    for (const child of el.children) {
      if (truncated) return;
      if (SKIP_TAGS.has(child.tagName)) continue;
      if (!visible(child)) continue;

      const role = roleOf(child);
      const name = role ? nameOf(child) : "";
      const interactive = role ? INTERACTIVE.has(role) : false;
      // Un nodo se emite si aporta algo: un rol con nombre, o algo accionable.
      let emit = Boolean(role) && (Boolean(name) || interactive);
      if (INTERACTIVE_ONLY && !interactive) emit = false;
      if (COMPACT && role && !name && !interactive) emit = false;

      if (emit && depth < MAX_DEPTH) {
        const attrs = attrsOf(child, role);
        if (name || interactive) attrs.push("ref=e" + ++refSeq);
        let label = "- " + role;
        if (name) {
          const shown = COMPACT && name.length > 120 ? name.slice(0, 120) + "…" : name;
          label += ' "' + shown.replace(/"/g, "'") + '"';
        }
        if (attrs.length) label += " [" + attrs.join(", ") + "]";
        const line = "  ".repeat(depth) + label;
        if (lines.join("\\n").length + line.length > LIMIT) { truncated = true; return; }
        lines.push(line);
      }

      // Sin línea propia, los hijos suben de nivel: así el árbol no se llena de
      // sangría por cada <div> de maquetado.
      walk(child, emit && depth < MAX_DEPTH ? depth + 1 : depth);
    }
  }

  walk(document.body || document.documentElement, 0);
  if (truncated) lines.push("… (snapshot truncado)");
  return lines.join("\\n");
})()`;
}

export class WebViewBackend implements BrowserBackend {
  private view: BunWebView | null = null;
  private _url = "";
  /** Cola de una sola vía: WebView rechaza operaciones solapadas. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly options: {
      width?: number;
      height?: number;
      show?: boolean;
      engine?: WebViewEngine;
    } = {},
  ) {}

  private ensureView(): BunWebView {
    if (this.view) return this.view;

    const WebView = (globalThis as { Bun?: { WebView?: unknown } }).Bun?.WebView;
    if (typeof WebView !== "function") {
      throw new Error("Bun.WebView no está disponible en este runtime (requiere Bun >= 1.3)");
    }

    const engine = this.options.engine ?? resolveWebViewEngine();
    if (!engine) {
      throw new Error(
        "Bun.WebView no tiene motor utilizable: WebKit sólo existe en macOS y no se encontró Chrome. " +
          "Instalá Chrome o definí BUN_CHROME_PATH.",
      );
    }

    // `url: false` es obligatorio para automatización desatendida: sin eso el
    // motor chrome intenta CONECTARSE a un Chrome que ya esté corriendo, y esa
    // ruta abre un diálogo "Allow remote debugging?" que cuelga el proceso
    // esperando un click que en un servidor no llega nunca.
    const backend =
      engine === "chrome"
        ? { type: "chrome" as const, url: false as const, stderr: "ignore" as const }
        : ("webkit" as const);

    // Sin `url` inicial a propósito: construir con uno deja una navegación
    // pendiente y el primer navigate() explota con ERR_INVALID_STATE.
    const Ctor = WebView as unknown as new (opts: unknown) => BunWebView;
    this.view = new Ctor({
      backend,
      show: this.options.show ?? false,
      width: this.options.width ?? 1280,
      height: this.options.height ?? 800,
    });
    log.info(`✅ WebView abierto (motor: ${engine}, in-process)`);
    return this.view;
  }

  /** Serializa: cada operación espera a que termine la anterior. */
  private run<T>(operation: (view: BunWebView) => Promise<T>): Promise<T> {
    const next = this.queue.then(
      () => operation(this.ensureView()),
      () => operation(this.ensureView()),
    );
    // La cola no debe romperse porque una operación haya fallado.
    this.queue = next.catch(() => undefined);
    return next;
  }

  get url(): string {
    return this.view?.url || this._url;
  }

  get title(): string {
    return this.view?.title || "";
  }

  get loading(): boolean {
    return this.view?.loading ?? false;
  }

  async navigate(url: string): Promise<void> {
    const target = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
    await this.run((view) => view.navigate(target));
    this._url = this.view?.url || target;
  }

  async evaluate<T = unknown>(script: string): Promise<T> {
    const trimmed = script.trim();
    let wrapped = script;
    if (/\bawait\b/.test(script) && !trimmed.startsWith("(async") && !trimmed.startsWith("async function")) {
      wrapped = trimmed.startsWith("return")
        ? `(async () => { ${script} })()`
        : `(async () => { return ${script}; })()`;
    }
    return (await this.run((view) => view.evaluate(wrapped))) as T;
  }

  async screenshot(_options?: ScreenshotOptions): Promise<string> {
    const blob = await this.run((view) => view.screenshot());
    return Buffer.from(await blob.arrayBuffer()).toString("base64");
  }

  async screenshotElement(selector: string): Promise<string> {
    const box = await this.evaluate<{ x: number; y: number; width: number; height: number } | null>(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: "center", inline: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()`,
    );
    if (!box || box.width <= 0 || box.height <= 0) {
      throw new Error(`screenshot failed: elemento no visible o inexistente: ${selector}`);
    }

    // WebView.screenshot() no recorta, pero el puente CDP sí acepta `clip`.
    const shot = await this.run((view) =>
      view.cdp("Page.captureScreenshot", {
        format: "png",
        clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
      }),
    );
    const data = (shot as { data?: string })?.data;
    if (!data) throw new Error(`screenshot failed: CDP no devolvió imagen para ${selector}`);
    return data;
  }

  async snapshot(options?: SnapshotOptions): Promise<string> {
    const script = buildSnapshotScript({
      compact: options?.compact !== false,
      depth: options?.depth ?? 12,
      interactiveOnly: options?.interactiveOnly ?? false,
    });
    return (await this.evaluate<string>(script)) || "";
  }

  async click(selector: string, _options?: Record<string, unknown>): Promise<void> {
    await this.run((view) => view.click(selector));
  }

  async type(text: string): Promise<void> {
    await this.run((view) => view.type(text));
  }

  async typeIn(selector: string, text: string): Promise<void> {
    const focused = await this.evaluate<boolean>(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); return true; })()`,
    );
    if (!focused) throw new Error(`type failed: elemento no encontrado: ${selector}`);
    await this.run((view) => view.type(text));
  }

  async fill(selector: string, text: string): Promise<void> {
    // `fill` reemplaza; `type` agrega. Se limpia primero y se disparan los
    // eventos que esperan React y compañía para registrar el cambio.
    const ok = await this.evaluate<boolean>(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.focus();
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`,
    );
    if (!ok) throw new Error(`fill failed: elemento no encontrado: ${selector}`);
    await this.run((view) => view.type(text));
    await this.evaluate(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) el.dispatchEvent(new Event("change", { bubbles: true }));
      })()`,
    );
  }

  async press(key: string, options?: { modifiers?: string[] }): Promise<void> {
    const modifiers: Record<string, boolean> = {};
    for (const modifier of options?.modifiers ?? []) {
      const normalized = modifier.toLowerCase();
      if (normalized === "control" || normalized === "ctrl") modifiers.ctrl = true;
      else if (normalized === "shift") modifiers.shift = true;
      else if (normalized === "alt") modifiers.alt = true;
      else if (normalized === "meta" || normalized === "cmd") modifiers.meta = true;
    }
    await this.run((view) => view.press(key, modifiers));
  }

  async scroll(dx: number, dy: number): Promise<void> {
    await this.run((view) => view.scroll(dx, dy));
  }

  async scrollTo(selector: string, _options?: { behavior?: "smooth" | "instant" }): Promise<void> {
    await this.run((view) => view.scrollTo(selector));
  }

  async back(): Promise<void> {
    await this.run((view) => view.goBack());
  }

  async forward(): Promise<void> {
    await this.run((view) => view.goForward());
  }

  async reload(): Promise<void> {
    await this.run((view) => view.reload());
  }

  async resize(width: number, height: number): Promise<void> {
    await this.run((view) => view.resize(width, height));
  }

  close(): void {
    try {
      this.view?.close();
    } catch {
      /* ya cerrado */
    }
    this.view = null;
  }
}
