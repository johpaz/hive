/**
 * WebViewBackend — `BrowserBackend` sobre `Bun.WebView` (Bun >= 1.3).
 *
 * Corre in-process: no hay subproceso, ni instalación, ni descarga de Chrome.
 * Un `evaluate` cuesta ~0,3 ms. Con motor chrome corre headless —Bun lanza el
 * navegador con `--headless`— así que también sirve en un servidor sin display;
 * lo único que necesita es un Chromium instalado.
 *
 * Tres restricciones del motor mandan sobre el diseño de este archivo:
 *
 *  1. `Bun.WebView` acepta **una sola operación pendiente por vista**; dos
 *     llamadas solapadas fallan con `ERR_INVALID_STATE: a simple operation is
 *     already pending`. Todo pasa por una cola serializada. (El límite es por
 *     vista: varias instancias sí trabajan en paralelo.)
 *  2. El perfil de Chrome es efímero y no configurable —`userDataDir` y `args`
 *     se ignoran—, así que las cookies se guardan y restauran a mano por CDP
 *     (`browser-session.ts`). Sin eso, cada reinicio perdería los logins.
 *  3. El motor webkit (macOS) no expone CDP. Todo lo que use `cdp()` tiene que
 *     tener camino alternativo: por eso `snapshot()` cae al DOM y `screenshot()`
 *     ignora las opciones cuando no hay puente CDP.
 */

import { logger } from "../../utils/logger.ts";
import { resolveWebViewEngine, type BrowserBackend, type ScreenshotOptions, type SnapshotOptions, type WebViewEngine } from "./browser-backend.ts";
import { loadStoredCookies, sessionPersistenceEnabled, storeCookies } from "./browser-session.ts";

const log = logger.child("webview-backend");

/** Tope del texto del snapshot: un DOM grande no puede comerse el contexto. */
const SNAPSHOT_CHAR_LIMIT = 20_000;

/**
 * Espera antes de volcar las cookies al almacén. Un login son varias
 * navegaciones seguidas (formulario, redirect, destino) y no tiene sentido
 * guardar en cada una; con esta ventana se guarda una vez, al final.
 */
const SESSION_SAVE_DEBOUNCE_MS = 3_000;

/**
 * Tope para las operaciones que el motor puede dejar pendientes para siempre.
 *
 * `WebView.click()` sobre un selector que no existe nunca resuelve, y como la
 * cola es de una sola vía, esa promesa cuelga **todo** el navegador: la
 * siguiente tool espera detrás y el agente se queda mudo. Con el tope, la
 * operación falla, la vista se descarta y la próxima abre una limpia.
 */
const OPERACION_TIMEOUT_MS = 15_000;

/** Nombres de tecla de uso común → los que entiende `Bun.WebView`. */
const ALIAS_DE_TECLA: Record<string, string> = {
  return: "Enter",
  enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  del: "Delete",
  delete: "Delete",
  back: "Backspace",
  backspace: "Backspace",
  space: " ",
  spacebar: " ",
  tab: "Tab",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  pageup: "PageUp",
  pagedown: "PageDown",
  home: "Home",
  end: "End",
};

/**
 * Forma real de `Bun.WebView`, verificada contra el prototipo en 1.4.0.
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

// ─── snapshot por árbol de accesibilidad (CDP) ────────────────────────────────

/**
 * Un nodo tal como lo devuelve `Accessibility.getFullAXTree`.
 *
 * Se tipa a mano y flojo: es JSON crudo del protocolo, y Chrome agrega campos
 * entre versiones. Sólo se declara lo que este archivo lee.
 */
interface AxNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  properties?: Array<{ name?: string; value?: { value?: unknown } }>;
  childIds?: string[];
}

/** Roles que no aportan una línea: contenedores y nodos de texto interno. */
const AX_SKIP_ROLES = new Set([
  "generic", "none", "presentation", "GenericContainer", "InlineTextBox",
  "StaticText", "LineBreak", "RootWebArea", "WebArea", "Ignored",
]);

/** Roles accionables: se emiten aunque no tengan nombre accesible. */
const AX_INTERACTIVE = new Set([
  "link", "button", "textbox", "checkbox", "radio", "combobox", "option",
  "searchbox", "menuitem", "menuitemcheckbox", "menuitemradio", "tab",
  "switch", "slider", "spinbutton",
]);

/** Propiedades del nodo que sí vale la pena mostrarle al modelo. */
const AX_SHOWN_PROPERTIES = ["level", "disabled", "checked", "expanded", "required", "selected"];

function axProperty(node: AxNode, name: string): unknown {
  return node.properties?.find((p) => p.name === name)?.value?.value;
}

/**
 * Convierte el árbol de accesibilidad en el mismo texto que produce el
 * recorrido del DOM: `- rol "nombre" [attrs, ref=eN]`, con sangría por cada
 * nivel realmente emitido.
 *
 * Es la fuente preferida porque es la que Chrome le da a un lector de pantalla:
 * resuelve nombres accesibles, roles implícitos y contenido oculto sin que este
 * archivo tenga que reimplementar esas reglas.
 */
function formatAxTree(nodes: AxNode[], options: Required<SnapshotOptions>): string {
  const byId = new Map<string, AxNode>();
  const hijos = new Set<string>();
  for (const node of nodes) {
    byId.set(node.nodeId, node);
    for (const child of node.childIds ?? []) hijos.add(child);
  }
  const raices = nodes.filter((n) => !hijos.has(n.nodeId));

  const lines: string[] = [];
  let refSeq = 0;
  let largo = 0;
  let truncado = false;

  /** El nombre de un nodo de texto sale de sus hijos StaticText, como en el DOM. */
  function nombreDe(node: AxNode): string {
    const propio = (node.name?.value ?? "").toString().replace(/\s+/g, " ").trim();
    if (propio) return propio;

    let texto = "";
    for (const id of node.childIds ?? []) {
      const child = byId.get(id);
      if (child?.role?.value === "StaticText") texto += " " + (child.name?.value ?? "");
    }
    return texto.replace(/\s+/g, " ").trim();
  }

  function atributos(node: AxNode, role: string): string[] {
    const attrs: string[] = [];
    for (const name of AX_SHOWN_PROPERTIES) {
      const value = axProperty(node, name);
      if (value === undefined || value === false || value === "false") continue;
      // `heading` ya dice que es un encabezado; lo informativo es el nivel.
      if (name === "level" && role !== "heading") continue;
      attrs.push(value === true || value === "true" ? name : `${name}=${value}`);
    }
    return attrs;
  }

  function walk(node: AxNode, depth: number): void {
    if (truncado) return;

    const role = node.role?.value ?? "";
    const saltear = node.ignored === true || AX_SKIP_ROLES.has(role) || !role;
    const interactivo = AX_INTERACTIVE.has(role);
    const name = saltear ? "" : nombreDe(node);

    let emitir = !saltear && (Boolean(name) || interactivo);
    if (options.interactiveOnly && !interactivo) emitir = false;
    if (options.compact && !name && !interactivo) emitir = false;

    if (emitir && depth < options.depth) {
      const attrs = atributos(node, role);
      if (name || interactivo) attrs.push("ref=e" + ++refSeq);
      let label = "- " + role;
      if (name) {
        const shown = options.compact && name.length > 120 ? name.slice(0, 120) + "…" : name;
        label += ' "' + shown.replace(/"/g, "'") + '"';
      }
      if (attrs.length) label += " [" + attrs.join(", ") + "]";

      const line = "  ".repeat(depth) + label;
      if (largo + line.length > SNAPSHOT_CHAR_LIMIT) {
        truncado = true;
        return;
      }
      lines.push(line);
      largo += line.length + 1;
    } else {
      emitir = false;
    }

    // Igual que en el DOM: si el nodo no emitió línea, sus hijos no bajan de
    // nivel, así el árbol no se hunde por cada contenedor de maquetado.
    const siguiente = emitir && depth < options.depth ? depth + 1 : depth;
    for (const id of node.childIds ?? []) {
      const child = byId.get(id);
      if (child) walk(child, siguiente);
      if (truncado) return;
    }
  }

  for (const raiz of raices) walk(raiz, 0);
  if (truncado) lines.push("… (snapshot truncado)");
  return lines.join("\n");
}

export class WebViewBackend implements BrowserBackend {
  private view: BunWebView | null = null;
  private _url = "";
  /** Cola de una sola vía: WebView rechaza operaciones solapadas. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Motor con el que se abrió la vista; sólo `chrome` tiene puente CDP. */
  private engine: WebViewEngine | null = null;
  /** `Accessibility.enable` se manda una vez por vista, no en cada snapshot. */
  private axEnabled = false;
  /** La sesión guardada se restaura una sola vez, antes de la primera página. */
  private sessionRestored = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly options: {
      width?: number;
      height?: number;
      show?: boolean;
      engine?: WebViewEngine;
      /** Guardar y restaurar cookies entre procesos. Default: sí. */
      persistSession?: boolean;
    } = {},
  ) {}

  /** ¿Hay puente CDP? El motor webkit de macOS no lo tiene. */
  private get hasCdp(): boolean {
    return (this.engine ?? this.options.engine ?? resolveWebViewEngine()) === "chrome";
  }

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
          "Instala Chrome o define BUN_CHROME_PATH.",
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
    this.engine = engine;
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

  /**
   * Como `run`, pero con tope. Si se cumple, la vista queda descartada: su cola
   * sigue esperando a una operación que no va a volver, así que lo único
   * recuperable es abrir otra.
   */
  private async runVigilado<T>(
    operation: (view: BunWebView) => Promise<T>,
    quehacia: string,
    ms = OPERACION_TIMEOUT_MS,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${quehacia} no respondió en ${ms}ms`)), ms);
      (timer as { unref?: () => void }).unref?.();
    });

    try {
      return await Promise.race([this.run(operation), limite]);
    } catch (error) {
      if ((error as Error).message.includes("no respondió")) {
        log.warn(`${quehacia} colgó el WebView; se descarta la vista`);
        this.close();
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
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
    await this.restoreSession();
    await this.run((view) => view.navigate(target));
    this._url = this.view?.url || target;
    this.scheduleSessionSave();
  }

  // ─── sesión persistente ─────────────────────────────────────────────────────

  /**
   * Devuelve las cookies guardadas al navegador, una sola vez y antes de la
   * primera página real.
   *
   * Hace falta un `about:blank` previo porque `cdp()` no tiene sesión hasta que
   * la vista navegó alguna vez, y `Network.setCookies` tiene que correr antes
   * de la página de destino para que el request ya salga autenticado.
   */
  private async restoreSession(): Promise<void> {
    if (this.sessionRestored) return;
    this.sessionRestored = true;
    if (!sessionPersistenceEnabled(this.options.persistSession) || !this.hasCdp) return;

    try {
      const cookies = await loadStoredCookies();
      if (!cookies.length) return;

      await this.run(async (view) => {
        await view.navigate("about:blank");
        await view.cdp("Network.setCookies", { cookies });
      });
      log.info(`sesión del navegador restaurada (${cookies.length} cookies)`);
    } catch (err) {
      // Una sesión que no se pudo restaurar es un login perdido, no un fallo de
      // la navegación: el agente sigue, sólo que deslogueado.
      log.warn(`no se pudo restaurar la sesión: ${(err as Error).message}`);
    }
  }

  /** Agenda un volcado de cookies; las llamadas seguidas se funden en una. */
  private scheduleSessionSave(): void {
    if (!sessionPersistenceEnabled(this.options.persistSession) || !this.hasCdp) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveSession();
    }, SESSION_SAVE_DEBOUNCE_MS);
    // Un guardado pendiente no puede ser motivo para que el proceso no termine.
    (this.saveTimer as { unref?: () => void }).unref?.();
  }

  /**
   * Vuelca la sesión ya, sin esperar la ventana del debounce. Lo usan el
   * apagado ordenado y los tests; el camino normal es `scheduleSessionSave()`.
   */
  /**
   * Guarda la sesión ahora y falla si no puede.
   *
   * A diferencia del guardado periódico, aquí alguien pidió expresamente que la
   * sesión quede en disco, así que callarse un fallo convierte el problema en
   * "la cookie no aparece" mucho más tarde y en otro sitio — que es justo cómo
   * se vivió desde una integración continua, sin forma de saber la causa.
   */
  async flushSession(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveSession(true);
  }

  private async saveSession(estricto = false): Promise<void> {
    const rendirse = (motivo: string) => {
      if (estricto) throw new Error(`no se pudo guardar la sesión: ${motivo}`);
    };
    if (!this.view) return rendirse("no hay ninguna vista abierta");
    // Apagada por configuración: no hay nada que guardar y tampoco un problema
    // que contar. Sólo se protesta cuando debía guardar y no pudo.
    if (!sessionPersistenceEnabled(this.options.persistSession)) return;
    if (!this.hasCdp) {
      return rendirse(`el motor «${this.engine ?? this.options.engine ?? "?"}» no expone CDP`);
    }
    try {
      const res = (await this.run((view) => view.cdp("Network.getAllCookies"))) as {
        cookies?: unknown[];
      };
      const cookies = res?.cookies ?? [];
      const guardadas = await storeCookies(cookies);
      if (guardadas) log.debug(`sesión del navegador guardada (${guardadas} cookies)`);
      else if (estricto && cookies.length === 0) {
        throw new Error("el navegador no reportó ninguna cookie");
      }
    } catch (err) {
      if (estricto) throw err;
      log.warn(`no se pudo guardar la sesión: ${(err as Error).message}`);
    }
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

  async screenshot(options?: ScreenshotOptions): Promise<string> {
    const format = options?.format ?? "png";
    const clip = options?.clip;

    // `view.screenshot()` sólo sabe hacer un PNG del viewport entero. Todo lo
    // demás —jpeg, calidad, recorte— sale por CDP, que además evita mandarle al
    // modelo un PNG de 1 MB cuando pidió un jpeg al 70%.
    const necesitaCdp = format !== "png" || Boolean(clip) || options?.quality !== undefined;
    if (necesitaCdp && this.hasCdp) {
      const params: Record<string, unknown> = { format };
      if (format !== "png" && options?.quality !== undefined) params.quality = options.quality;
      if (clip) params.clip = clip;

      const shot = (await this.run((view) => view.cdp("Page.captureScreenshot", params))) as {
        data?: string;
      };
      if (shot?.data) return shot.data;
      log.warn("CDP no devolvió imagen; se usa la captura nativa del WebView");
    }

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
    const opciones: Required<SnapshotOptions> = {
      compact: options?.compact !== false,
      depth: options?.depth ?? 12,
      interactiveOnly: options?.interactiveOnly ?? false,
    };

    // Primero el árbol de accesibilidad de verdad: es el que Chrome le entrega
    // a un lector de pantalla, así que resuelve nombres accesibles, roles
    // implícitos y contenido oculto mejor que cualquier recorrido del DOM.
    if (this.hasCdp) {
      try {
        const tree = (await this.run(async (view) => {
          if (!this.axEnabled) {
            await view.cdp("Accessibility.enable");
            this.axEnabled = true;
          }
          return view.cdp("Accessibility.getFullAXTree");
        })) as { nodes?: AxNode[] };

        // Un árbol vacío es una página vacía, no un fallo: se devuelve tal cual.
        return formatAxTree(tree?.nodes ?? [], opciones);
      } catch (err) {
        log.warn(`árbol de accesibilidad no disponible, se recorre el DOM: ${(err as Error).message}`);
      }
    }

    return (await this.evaluate<string>(buildSnapshotScript(opciones))) || "";
  }

  /**
   * Puente CDP crudo, por la misma cola que el resto. Sólo con motor chrome:
   * el WebKit de macOS no lo tiene, y por eso todo lo que lo use necesita un
   * camino alternativo.
   */
  async cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.hasCdp) {
      throw new Error("Bun.WebView con motor webkit no expone CDP");
    }
    return (await this.run((view) => view.cdp(method, params))) as T;
  }

  async click(selector: string, options?: Record<string, unknown>): Promise<void> {
    // El motor no falla cuando el selector no existe: se queda esperando a que
    // aparezca, para siempre. Comprobarlo acá convierte ese cuelgue en el error
    // que la tool sabe reportar.
    const existe = await this.evaluate<boolean>(
      `!!document.querySelector(${JSON.stringify(selector)})`,
    );
    if (!existe) throw new Error(`click failed: elemento no encontrado: ${selector}`);

    // `browser_click` acepta un timeout y hasta ahora nadie lo miraba.
    const tope = typeof options?.timeout === "number" ? options.timeout : undefined;
    await this.runVigilado((view) => view.click(selector), `click(${selector})`, tope);
    // Un submit de login deja la cookie sin que haya un navigate() explícito.
    this.scheduleSessionSave();
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
    // El motor sólo acepta su propia lista ("Enter", "Escape", "ArrowUp"...) y
    // lanza con cualquier otro nombre. Los modelos y el código viejo escriben
    // "Return", "Esc" o "Del", que son los nombres de toda la vida.
    const tecla = ALIAS_DE_TECLA[key.toLowerCase()] ?? key;

    const modifiers: Record<string, boolean> = {};
    for (const modifier of options?.modifiers ?? []) {
      const normalized = modifier.toLowerCase();
      if (normalized === "control" || normalized === "ctrl") modifiers.ctrl = true;
      else if (normalized === "shift") modifiers.shift = true;
      else if (normalized === "alt") modifiers.alt = true;
      else if (normalized === "meta" || normalized === "cmd") modifiers.meta = true;
    }
    await this.run((view) => view.press(tecla, modifiers));
  }

  async scroll(dx: number, dy: number): Promise<void> {
    await this.run((view) => view.scroll(dx, dy));
  }

  async scrollTo(selector: string, _options?: { behavior?: "smooth" | "instant" }): Promise<void> {
    await this.run((view) => view.scrollTo(selector));
  }

  /**
   * Ir y volver en el historial.
   *
   * `goBack()`/`goForward()` del motor **no resuelven nunca** con páginas HTTP
   * reales —con `data:` URLs sí, que es por lo que pasaba desapercibido— y como
   * la cola es de una sola vía, dejaban colgado todo el navegador. Con CDP se
   * pide el historial y se salta a la entrada que toca, que además permite
   * decir "no hay página anterior" en vez de esperar a que algo pase.
   */
  private async irEnHistorial(delta: -1 | 1): Promise<void> {
    if (!this.hasCdp) {
      await this.runVigilado(
        (view) => (delta < 0 ? view.goBack() : view.goForward()),
        delta < 0 ? "back()" : "forward()",
      );
      return;
    }

    const historial = await this.cdp<{
      currentIndex: number;
      entries: Array<{ id: number; url: string }>;
    }>("Page.getNavigationHistory");

    const destino = historial.entries[historial.currentIndex + delta];
    if (!destino) {
      throw new Error(delta < 0 ? "no hay página anterior" : "no hay página siguiente");
    }

    await this.cdp("Page.navigateToHistoryEntry", { entryId: destino.id });
    this._url = destino.url;
    await this.esperarCarga();
  }

  /**
   * Espera a que la página termine de cargar. `navigateToHistoryEntry` vuelve
   * apenas dispara la navegación, así que sin esto el `evaluate` siguiente lee
   * la página vieja.
   */
  private async esperarCarga(ms = 5_000): Promise<void> {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      const listo = await this.evaluate<boolean>('document.readyState === "complete"').catch(() => false);
      if (listo) return;
      await Bun.sleep(25);
    }
  }

  async back(): Promise<void> {
    await this.irEnHistorial(-1);
  }

  async forward(): Promise<void> {
    await this.irEnHistorial(1);
  }

  async reload(): Promise<void> {
    await this.run((view) => view.reload());
  }

  async resize(width: number, height: number): Promise<void> {
    await this.run((view) => view.resize(width, height));
  }

  close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      this.view?.close();
    } catch {
      /* ya cerrado */
    }
    this.view = null;
    this.axEnabled = false;
    // La cola encadenaba sobre la vista que se fue: si quedó una operación
    // pendiente, todo lo que viniera detrás esperaría a un fantasma.
    this.queue = Promise.resolve();
  }
}
