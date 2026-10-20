import { homedir } from "node:os"
/**
 * Browser automation via Obscura (https://obscura.sh) — direct MCP 2.0 client.
 *
 * Architecture:
 *   - Spawns the Obscura CLI as an MCP server subprocess: `obscura mcp` (stdio).
 *   - Speaks MCP 2.0 (stateless revision 2026-07-28) FIRST: tries `server/discover`
 *     with the protocol version in `params._meta`. If the server does not know the
 *     RPC (e.g. Obscura 0.2.x negotiates 2024-11-05), it falls back automatically
 *     to the legacy `initialize` handshake. When Obscura ships MCP 2.0 support the
 *     client switches to the stateless flow with zero code changes.
 *   - The server keeps ONE live browser session: navigate first, then read/act.
 *     Element refs (e.g. "e3") come from browser_snapshot / browser_interactive_elements.
 *   - Auto-restart: if the subprocess dies, the next tool call respawns it.
 *   - Image/PDF content blocks are persisted to ~/.hive/screenshots/ and
 *     returned with both path and base64.
 *
 * Binary resolution order:
 *   1. OBSCURA_PATH env var
 *   2. `obscura` on PATH
 *   3. ~/.hive/bin/obscura, then ~/.hivecode/bin/obscura (shared with hivecode)
 *
 * Tuning env vars: OBSCURA_STEALTH=1, OBSCURA_PROXY=<url>,
 *   OBSCURA_USER_AGENT=<ua>, OBSCURA_ALLOW_PRIVATE_NETWORK=1
 */

import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { logger } from "../../utils/logger.ts"
import type { Tool, ToolParameter } from "../types.ts"
import type { Subprocess } from "bun"

const log = logger.child("obscura")

// ── MCP 2.0 protocol constants ────────────────────────────────────────────────

/** MCP 2.0 — stateless revision of the Model Context Protocol. */
const MCP_PROTOCOL_2_0 = "2026-07-28"

/** Legacy fallback revision for servers that still use the initialize handshake. */
const MCP_LEGACY_FALLBACK = "2025-06-18"

const CLIENT_INFO = { name: "hive", version: "1.0" } as const

/**
 * Per-request `_meta` prescribed by MCP 2.0 (2026-07-28): every request carries
 * its protocol version, client identity and client capabilities.
 */
function mcp2Meta(): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_2_0,
    "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
    "io.modelcontextprotocol/clientCapabilities": {},
  }
}

// ── Binary resolution ─────────────────────────────────────────────────────────

let cachedBin: string | null | undefined

export function resolveObscuraBin(): string | null {
  if (cachedBin !== undefined) return cachedBin

  // 1. OBSCURA_PATH (explicit override)
  if (process.env.OBSCURA_PATH && existsSync(process.env.OBSCURA_PATH)) {
    cachedBin = process.env.OBSCURA_PATH
    return cachedBin
  }

  // 2. PATH (global install)
  try {
    const r = Bun.spawnSync(["which", "obscura"], {
      stdout: "pipe", stderr: "ignore", stdin: "ignore",
    })
    if (r.exitCode === 0) {
      const p = r.stdout.toString().trim()
      if (p.length > 0) { cachedBin = p; return cachedBin }
    }
  } catch { /* ignore */ }

  // 3. Instalación gestionada: ~/.hive/bin primero, ~/.hivecode/bin (hivecode) como respaldo
  for (const dir of [join(homedir(), ".hive", "bin"), join(homedir(), ".hivecode", "bin")]) {
    const managed = join(dir, process.platform === "win32" ? "obscura.exe" : "obscura")
    if (existsSync(managed)) {
      cachedBin = managed
      return cachedBin
    }
  }

  cachedBin = null
  return null
}

/** True when the Obscura CLI is available (used for capability reporting). */
export function obscuraAvailable(): boolean {
  return resolveObscuraBin() !== null
}

const INSTALL_ERROR =
  "Obscura browser CLI not installed. See https://docs.obscura.sh/quickstart/installation " +
  "and put the binary in PATH or ~/.hive/bin/obscura, or set OBSCURA_PATH. " +
  "Use the browser_* tools (Chrome) meanwhile."

// ── MCP session (stdio JSON-RPC 2.0) ──────────────────────────────────────────

/** Bun.spawn stdin when piped is a FileSink (its type union also includes the fd number). */
interface StdinSink {
  write(data: string | Uint8Array): number | Promise<number>
  flush(): number | Promise<number>
  end(): number | Promise<number>
}

function stdinSink(proc: Subprocess): StdinSink {
  return proc.stdin as unknown as StdinSink
}

interface JsonRpcError { code: number; message: string; data?: unknown }

interface ContentBlock {
  type: string
  text?: string
  data?: string          // image block: base64 payload
  mimeType?: string
  resource?: { blob?: string; mimeType?: string; uri?: string; text?: string }
}

interface ToolCallResult {
  content?: ContentBlock[]
  isError?: boolean
  structuredContent?: unknown
}

type PendingEntry = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

class ObscuraMcpSession {
  private proc: Subprocess | null = null
  private nextId = 1
  private pending = new Map<number, PendingEntry>()
  private stdoutBuf = ""
  private mode: "mcp2" | "legacy" = "legacy"
  private negotiatedVersion: string | null = null
  private serverName = "obscura-mcp"
  private starting: Promise<void> | null = null

  /** Ensure a live, negotiated MCP session (idempotent, concurrent-safe). */
  ensure(): Promise<void> {
    if (this.proc && this.proc.exitCode === null) return Promise.resolve()
    this.starting ??= this.start().finally(() => { this.starting = null })
    return this.starting
  }

  private async start(): Promise<void> {
    const bin = resolveObscuraBin()
    if (!bin) throw new Error(INSTALL_ERROR)

    const args = ["mcp"]
    if (process.env.OBSCURA_STEALTH === "1" || process.env.OBSCURA_STEALTH === "true") args.push("--stealth")
    if (process.env.OBSCURA_PROXY) args.push("--proxy", process.env.OBSCURA_PROXY)
    if (process.env.OBSCURA_USER_AGENT) args.push("--user-agent", process.env.OBSCURA_USER_AGENT)
    if (process.env.OBSCURA_ALLOW_PRIVATE_NETWORK === "1" || process.env.OBSCURA_ALLOW_PRIVATE_NETWORK === "true") {
      args.push("--allow-private-network")
    }

    log.info(`[obscura] starting MCP server: ${bin} ${args.join(" ")}`)
    const proc = Bun.spawn([bin, ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    this.proc = proc
    this.stdoutBuf = ""

    // Best-effort cleanup when the host process exits
    try { process.once("exit", () => { try { proc.kill() } catch { /* ignore */ } }) } catch { /* ignore */ }

    void this.readStdout(proc)
    void this.readStderr(proc)

    proc.exited.then((code) => {
      if (this.proc === proc) this.proc = null
      const err = new Error(`obscura mcp server exited (code ${code})`)
      for (const [, entry] of this.pending) { clearTimeout(entry.timer); entry.reject(err) }
      this.pending.clear()
      if (code !== 0) log.warn(`[obscura] MCP server exited with code ${code}`)
    }).catch(() => { /* killed */ })

    await this.negotiate()
  }

  private async readStdout(proc: Subprocess): Promise<void> {
    const reader = (proc.stdout as ReadableStream).getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        this.stdoutBuf += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = this.stdoutBuf.indexOf("\n")) !== -1) {
          const line = this.stdoutBuf.slice(0, idx).trim()
          this.stdoutBuf = this.stdoutBuf.slice(idx + 1)
          if (line) this.handleLine(line)
        }
      }
    } catch { /* stream closed */ }
  }

  private async readStderr(proc: Subprocess): Promise<void> {
    const reader = (proc.stderr as ReadableStream).getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const t = decoder.decode(value, { stream: true }).trim()
        if (t) log.debug(`[obscura:mcp] ${t.slice(0, 300)}`)
      }
    } catch { /* stream closed */ }
  }

  private handleLine(line: string): void {
    let msg: {
      jsonrpc?: string
      id?: number
      method?: string
      params?: unknown
      result?: unknown
      error?: JsonRpcError
    }
    try { msg = JSON.parse(line) } catch {
      log.debug(`[obscura:mcp] non-JSON stdout: ${line.slice(0, 200)}`)
      return
    }

    // Response to a pending request
    if (typeof msg.id === "number") {
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id)
      clearTimeout(entry.timer)
      if (msg.error) {
        entry.reject(Object.assign(new Error(msg.error.message ?? "MCP error"), { code: msg.error.code }))
      } else {
        entry.resolve(msg.result)
      }
      return
    }

    // Notification from the server
    if (msg.method) log.debug(`[obscura:mcp] notification: ${msg.method}`)
  }

  /** Low-level request — assumes the subprocess is alive. */
  private rawRequest(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const proc = this.proc
    if (!proc) return Promise.reject(new Error("obscura MCP server not running"))

    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve,
        reject,
        timer,
      })
      try {
        const sink = stdinSink(proc)
        sink.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
        sink.flush()
      } catch (err) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(err as Error)
      }
    })
  }

  /** Notification — fire and forget (no id). */
  private notify(method: string): void {
    const proc = this.proc
    if (!proc) return
    try {
      const sink = stdinSink(proc)
      sink.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n")
      sink.flush()
    } catch { /* ignore */ }
  }

  /**
   * MCP 2.0-first negotiation:
   *   1. `server/discover` with protocol version in `_meta` (2026-07-28 flow).
   *   2. On unknown-method / error / timeout → legacy `initialize` handshake.
   */
  private async negotiate(): Promise<void> {
    // 1. MCP 2.0 (stateless) — no handshake required
    try {
      const discovered = await this.rawRequest("server/discover", { _meta: mcp2Meta() }, 5_000) as
        { serverInfo?: { name?: string; version?: string } } | null
      this.mode = "mcp2"
      this.negotiatedVersion = MCP_PROTOCOL_2_0
      this.serverName = discovered?.serverInfo?.name ?? "obscura-mcp"
      log.info(`[obscura] MCP 2.0 (${MCP_PROTOCOL_2_0}) stateless session — ${this.serverName}`)
      return
    } catch {
      // fall through to the legacy handshake
    }

    // 2. Legacy handshake — request 2.0 first; if the server rejects the unknown
    //    version, retry with a known-good legacy revision.
    let init: { protocolVersion?: string; serverInfo?: { name?: string; version?: string } } | null = null
    for (const revision of [MCP_PROTOCOL_2_0, MCP_LEGACY_FALLBACK]) {
      try {
        init = await this.rawRequest("initialize", {
          protocolVersion: revision,
          capabilities: {},
          clientInfo: CLIENT_INFO,
        }, 5_000) as typeof init
        break
      } catch (err) {
        log.debug(`[obscura] initialize(${revision}) failed: ${(err as Error).message}`)
      }
    }
    if (!init) throw new Error("obscura MCP server did not complete the initialize handshake")

    this.mode = "legacy"
    this.negotiatedVersion = init.protocolVersion ?? "2024-11-05"
    this.serverName = init.serverInfo?.name ?? "obscura-mcp"
    this.notify("notifications/initialized")
    log.info(
      `[obscura] legacy MCP session (server ${this.serverName}, negotiated ${this.negotiatedVersion})`,
    )
  }

  /** JSON-RPC request on the live session (auto-starts / auto-restarts). */
  async rpc(method: string, params: unknown, timeoutMs = 60_000): Promise<unknown> {
    await this.ensure()
    const request = this.mode === "mcp2"
      ? { ...(params as object ?? {}), _meta: mcp2Meta() }
      : params
    return this.rawRequest(method, request, timeoutMs)
  }

  /** tools/call with content-block unpacking. */
  async callTool(name: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<object> {
    const result = await this.rpc("tools/call", { name, arguments: args }, timeoutMs) as ToolCallResult
    return unpackToolResult(name, result)
  }

  /** tools/list — for diagnostics and capability discovery. */
  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>> {
    const result = await this.rpc("tools/list", {}, 15_000) as
      { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> } | null
    return result?.tools ?? []
  }

  get protocolMode(): "mcp2" | "legacy" { return this.mode }
  get protocolVersion(): string | null { return this.negotiatedVersion }

  async close(): Promise<void> {
    const proc = this.proc
    this.proc = null
    if (!proc) return
    try { stdinSink(proc).end() } catch { /* ignore */ }
    try { proc.kill() } catch { /* ignore */ }
  }
}

let session: ObscuraMcpSession | null = null
function getSession(): ObscuraMcpSession {
  session ??= new ObscuraMcpSession()
  return session
}

/** Kill the Obscura MCP subprocess (used on shutdown). */
export async function closeObscura(): Promise<void> {
  await session?.close()
}

// ── Content unpacking ─────────────────────────────────────────────────────────

const ASSET_DIR = () => join(homedir(), ".hive", "screenshots")

function saveAsset(toolName: string, base64: string, mimeType: string): { path: string; bytes: number } {
  const dir = ASSET_DIR()
  mkdirSync(dir, { recursive: true })
  const ext = mimeType.includes("pdf") ? "pdf" : (mimeType.split("/")[1] ?? "bin").replace(/[^a-z0-9]/gi, "")
  const file = join(dir, `${toolName}-${Date.now()}.${ext}`)
  writeFileSync(file, Buffer.from(base64, "base64"))
  return { path: file, bytes: statSync(file).size }
}

function unpackToolResult(toolName: string, result: ToolCallResult): object {
  const blocks = result.content ?? []
  const texts: string[] = []
  const images: Array<{ path: string; bytes: number; mimeType: string }> = []

  for (const block of blocks) {
    if (block.type === "text" && block.text) {
      texts.push(block.text)
    } else if (block.type === "image" && block.data) {
      const mimeType = block.mimeType ?? "image/png"
      const saved = saveAsset(toolName, block.data, mimeType)
      images.push({ ...saved, mimeType })
    } else if (block.type === "resource" && block.resource?.blob) {
      const mimeType = block.resource.mimeType ?? "application/octet-stream"
      const saved = saveAsset(toolName, block.resource.blob, mimeType)
      images.push({ ...saved, mimeType })
    }
  }

  const text = texts.join("\n").trim()

  if (result.isError) {
    return { ok: false, error: text || `obscura tool ${toolName} failed`, tool: toolName }
  }

  if (images.length > 0) {
    const [first] = images
    return {
      ok: true,
      path: first.path,
      mimeType: first.mimeType,
      bytes: first.bytes,
      ...(text ? { text } : {}),
      ...(images.length > 1 ? { additional_assets: images.slice(1).map(i => i.path) } : {}),
    }
  }

  return { ok: true, text }
}

// ── Tool factory ──────────────────────────────────────────────────────────────

/**
 * Build a hivecode Tool backed by an Obscura MCP tool.
 * Only the properties declared in `properties` are forwarded to the server
 * (Obscura marks several schemas additionalProperties:false); `timeoutMs`
 * is a client-side kill switch and never reaches the wire.
 */
/** Hive-side name of an Obscura server tool: browser_snapshot → obscura_snapshot. */
function hiveName(serverName: string): string {
  return serverName.replace(/^browser_/, "obscura_")
}

function obscuraTool(
  name: string,
  description: string,
  properties: Record<string, ToolParameter>,
  required: string[] = [],
  opts: { timeoutMs?: number } = {},
): Tool {
  return {
    // The Obscura server knows these as browser_*; Hive keeps its own Chrome-backed
    // browser_* tools, so the Obscura ones are exposed as obscura_*.
    name: hiveName(name),
    description: description.replaceAll("browser_", "obscura_"),
    parameters: {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
    async execute(args: Record<string, unknown>): Promise<string | object> {
      if (!obscuraAvailable()) return { ok: false, error: INSTALL_ERROR }

      // Forward only schema-declared keys
      const serverArgs: Record<string, unknown> = {}
      for (const key of Object.keys(properties)) {
        if (args[key] !== undefined && args[key] !== null) serverArgs[key] = args[key]
      }

      const timeoutMs = args.timeoutMs !== undefined ? Number(args.timeoutMs) : opts.timeoutMs
      log.info(`[obscura] ${name} ${summarizeArgs(serverArgs)}`)
      try {
        return await getSession().callTool(name, serverArgs, timeoutMs ?? 60_000)
      } catch (err) {
        const message = (err as Error).message
        log.warn(`[obscura] ${name} failed: ${message}`)
        return { ok: false, error: message, tool: name }
      }
    },
  }
}

function summarizeArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args)
  if (keys.length === 0) return ""
  const parts: string[] = []
  for (const key of keys.slice(0, 3)) {
    const value = String(args[key])
    parts.push(`${key}=${value.length > 60 ? `${value.slice(0, 57)}…` : value}`)
  }
  if (keys.length > 3) parts.push(`+${keys.length - 3}`)
  return parts.join(" ")
}

const urlParam: ToolParameter = { type: "string", description: "URL to navigate to (http/https)" }
const refParam: ToolParameter = { type: "string", description: "Element ref from a recent obscura_snapshot / obscura_interactive_elements (e.g. 'e3')" }
const selectorParam: ToolParameter = { type: "string", description: "CSS selector (fallback when no ref is available)" }
const maxCharsParam: ToolParameter = { type: "number", description: "Truncate returned text to this many characters (default 4000)" }
const timeoutParam: ToolParameter = { type: "number", description: "Client-side timeout in milliseconds (default 60000)" }

// ── The full Obscura browser toolset ──────────────────────────────────────────

export function createObscuraTools(): Tool[] {
  return [
    // ── Navigation and lifecycle ────────────────────────────────────────────
    obscuraTool(
      "browser_navigate",
      "Navigate to a URL and wait for the page to load, keeping a live browser session for " +
      "subsequent browser_* tools. Returns the final URL and title only: read the page next with " +
      "browser_snapshot or browser_markdown. Spanish keywords: navegar, abrir página, ir a sitio web, cargar url, visitar",
      {
        url: urlParam,
        waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle0"], description: "Navigation wait condition (default: load)" },
        timeoutMs: timeoutParam,
      },
      ["url"],
      { timeoutMs: 90_000 },
    ),
    obscuraTool(
      "browser_back",
      "Navigate back in the page history (browser back button). Requires an active session from browser_navigate. " +
      "Spanish keywords: atrás, volver, página anterior, regresar",
      {},
    ),
    obscuraTool(
      "browser_forward",
      "Navigate forward in the page history. Requires an active session from browser_navigate. " +
      "Spanish keywords: adelante, página siguiente, avanzar",
      {},
    ),
    obscuraTool(
      "browser_reload",
      "Reload the current page. Requires an active session from browser_navigate. " +
      "Spanish keywords: recargar, refrescar página, actualizar página, f5",
      {},
    ),
    obscuraTool(
      "browser_close",
      "Close the current browser page and reset the session state. Spanish keywords: cerrar navegador, cerrar página, terminar sesión",
      {},
    ),

    // ── Read the page ───────────────────────────────────────────────────────
    obscuraTool(
      "browser_snapshot",
      "Get the current page as text: URL, title, readable body text and interactive element refs. " +
      "Preferred first read after navigating. Spanish keywords: snapshot página, contenido página, ver página, texto página, captura textual",
      { max_chars: maxCharsParam },
    ),
    obscuraTool(
      "browser_markdown",
      "Extract the current page as Markdown (headings, paragraphs, lists, links, code blocks). " +
      "Token-dense structured content instead of plain text. Spanish keywords: markdown, extraer markdown, contenido estructurado, página en markdown",
      { max_chars: maxCharsParam },
    ),
    obscuraTool(
      "browser_links",
      "List every anchor link on the current page as one JSON object per line {text, href}. " +
      "Spanish keywords: listar enlaces, ver links, urls página, hipervínculos, enlaces",
      {
        limit: { type: "number", description: "Max number of links to return (default 100)" },
        internal_only: { type: "boolean", description: "Only return links on the same origin as the current page" },
      },
    ),
    obscuraTool(
      "browser_interactive_elements",
      "List every clickable/typeable element with a stable ref ID and a brief description. " +
      "Use BEFORE clicking or filling to act by ref instead of guessing CSS selectors. " +
      "Spanish keywords: elementos interactivos, botones, campos, inputs, refs, elementos clicables",
      { limit: { type: "number", description: "Max number of elements (default 100)" } },
    ),
    obscuraTool(
      "browser_detect_forms",
      "List every <form> on the page with its action URL, method and a description of each " +
      "input/textarea/select. Understand a form before filling it. Spanish keywords: detectar formularios, ver formularios, campos formulario, estructura formulario",
      {},
    ),
    obscuraTool(
      "browser_extract",
      "Extract a structured object from the page given a map of {field_name: css_selector}. " +
      "Use 'selector@attr' for attributes (e.g. 'a@href') and 'field[]' suffix for arrays. " +
      "Spanish keywords: extraer datos, scraping, extraer estructura, datos página, seleccionar campos",
      {
        schema: {
          type: "object",
          description: "Map of field_name to CSS selector. Suffix selector with '@attr' for attribute, suffix field name with '[]' for array.",
          additionalProperties: { type: "string" },
        },
      },
      ["schema"],
    ),
    obscuraTool(
      "browser_get_attribute",
      "Read an attribute of an element (href, src, value, class, data-*). Returns the raw value or empty string. " +
      "Spanish keywords: leer atributo, obtener atributo, href, valor elemento, atributo html",
      { attribute: { type: "string", description: "Attribute name (e.g. href, value, src)" }, ref: refParam, selector: selectorParam },
      ["attribute"],
    ),
    obscuraTool(
      "browser_count",
      "Count how many elements on the page match a CSS selector. Cheap existence/pagination probe. " +
      "Spanish keywords: contar elementos, cuántos, número de elementos, contar coincidencias",
      { selector: selectorParam },
      ["selector"],
    ),
    obscuraTool(
      "browser_search",
      "Find substring matches in the visible page text with surrounding context. " +
      "Spanish keywords: buscar en página, encontrar texto, buscar contenido, texto en página",
      {
        query: { type: "string", description: "Substring to find in the visible page text" },
        case_sensitive: { type: "boolean", description: "Case-sensitive match (default false)" },
        limit: { type: "number", description: "Max matches to return (default 10)" },
        context_chars: { type: "number", description: "Chars on each side of the match (default 80)" },
      },
      ["query"],
    ),

    // ── Interact ─────────────────────────────────────────────────────────────
    obscuraTool(
      "browser_click",
      "Click an element by ref (preferred, from browser_snapshot/browser_interactive_elements) or CSS selector. " +
      "Spanish keywords: hacer clic, presionar botón, clickear, pulsar, click",
      { ref: refParam, selector: selectorParam },
    ),
    obscuraTool(
      "browser_fill",
      "Set the value of an input element (replaces existing value). Pass ref (preferred) or selector. " +
      "Spanish keywords: llenar campo, rellenar input, establecer valor, completar campo",
      { ref: refParam, selector: selectorParam, value: { type: "string", description: "Value to set" } },
      ["value"],
    ),
    obscuraTool(
      "browser_type",
      "Type text into an input element (appends to existing value). Pass ref (preferred) or selector. " +
      "Spanish keywords: escribir en campo, teclear texto, introducir texto, escribir input",
      { ref: refParam, selector: selectorParam, text: { type: "string", description: "Text to type" } },
      ["text"],
    ),
    obscuraTool(
      "browser_fill_form",
      "Fill multiple inputs in one call: fields is an array of {ref?, selector?, value, type?} where " +
      "type is text (default), check, uncheck or select. Optional submit_ref/submit_selector clicks after filling. " +
      "Spanish keywords: llenar formulario, completar formulario, rellenar form, enviar formulario",
      {
        fields: {
          type: "array",
          description: "Fields to fill: {ref?, selector?, value, type?}",
          items: {
            type: "object",
            properties: {
              ref: { type: "string" },
              selector: { type: "string" },
              value: { type: "string" },
              type: { type: "string", enum: ["text", "check", "uncheck", "select"] },
            },
          },
        },
        submit_ref: { type: "string", description: "Optional element to click after filling (e.g. submit button ref)" },
        submit_selector: { type: "string", description: "Optional CSS selector to click after filling" },
      },
      ["fields"],
    ),
    obscuraTool(
      "browser_press_key",
      "Dispatch a keyboard event (Enter, Tab, Escape…) on an element or the document. " +
      "Spanish keywords: presionar tecla, pulsar enter, teclado, keydown",
      { key: { type: "string", description: "Key name (e.g. Enter, Tab, Escape)" }, selector: selectorParam },
      ["key"],
    ),
    obscuraTool(
      "browser_select_option",
      "Select an option from a <select> element by value or visible text. " +
      "Spanish keywords: seleccionar opción, elegir opción, dropdown, lista desplegable, select",
      { selector: selectorParam, value: { type: "string", description: "Value or text of the option to select" } },
      ["selector", "value"],
    ),
    obscuraTool(
      "browser_scroll",
      "Scroll the page or an element: direction top/bottom/up/down/left/right, amount in pixels. " +
      "Use 'bottom' to trigger infinite-scroll loaders. Spanish keywords: scroll, desplazar, bajar página, subir página, desplazamiento",
      {
        direction: { type: "string", enum: ["top", "bottom", "up", "down", "left", "right"], description: "Scroll direction (default 'down')" },
        amount: { type: "number", description: "Pixels (default: one viewport)" },
        ref: refParam,
        selector: selectorParam,
      },
    ),

    // ── Wait and run JS ──────────────────────────────────────────────────────
    obscuraTool(
      "browser_wait_for",
      "Wait for a CSS selector to appear in the DOM (default 30s). Spanish keywords: esperar elemento, aguardar selector, wait selector, esperar carga",
      {
        selector: { type: "string", description: "CSS selector to wait for" },
        timeout: { type: "number", description: "Server-side timeout in seconds (default 30)" },
        timeoutMs: timeoutParam,
      },
      ["selector"],
      { timeoutMs: 60_000 },
    ),
    obscuraTool(
      "browser_wait_for_text",
      "Wait until a substring appears anywhere in the rendered page text — for result messages and notifications. " +
      "Spanish keywords: esperar texto, aguardar mensaje, esperar resultado, wait texto",
      {
        text: { type: "string", description: "Substring to wait for" },
        timeout: { type: "number", description: "Server-side timeout in seconds (default 30)" },
        timeoutMs: timeoutParam,
      },
      ["text"],
      { timeoutMs: 60_000 },
    ),
    obscuraTool(
      "browser_evaluate",
      "Evaluate a JavaScript expression in the page context and return the result as JSON. " +
      "Spanish keywords: ejecutar javascript, evaluar expresión, js en página, script navegador, eval",
      { expression: { type: "string", description: "JavaScript expression to evaluate" }, timeoutMs: timeoutParam },
      ["expression"],
      { timeoutMs: 30_000 },
    ),

    // ── Diagnostics ──────────────────────────────────────────────────────────
    obscuraTool(
      "browser_network_requests",
      "List the network requests made by the current page (URLs, statuses, timings). " +
      "Spanish keywords: ver peticiones red, requests, tráfico red, llamadas http página, network",
      {},
    ),
    obscuraTool(
      "browser_console_messages",
      "List the console messages logged by the current page (logs, warnings, errors). " +
      "Spanish keywords: ver consola, logs página, mensajes consola, errores javascript, console",
      {},
    ),

    // ── Visual output ────────────────────────────────────────────────────────
    obscuraTool(
      "browser_screenshot",
      "Capture the current rendered viewport as a PNG (saved to ~/.hivecode/screenshots/, returned with path + base64). " +
      "Use for canvas/visual verification; prefer browser_snapshot for text. Spanish keywords: captura de pantalla, screenshot, fotografiar página, imagen página, png",
      {
        width: { type: "number", description: "Optional CSS-pixel capture width" },
        height: { type: "number", description: "Optional CSS-pixel capture height" },
        timeoutMs: timeoutParam,
      },
      [],
      { timeoutMs: 45_000 },
    ),
    obscuraTool(
      "browser_pdf",
      "Export the current rendered document as a paginated PDF (saved to ~/.hivecode/screenshots/). " +
      "Spanish keywords: exportar pdf, guardar pdf, página a pdf, documento pdf",
      {
        landscape: { type: "boolean" },
        print_background: { type: "boolean" },
        scale: { type: "number", description: "0.1–2" },
        paper_width: { type: "number", description: "Paper width in inches" },
        paper_height: { type: "number", description: "Paper height in inches" },
        margin_top: { type: "number", description: "Top margin in inches" },
        margin_bottom: { type: "number", description: "Bottom margin in inches" },
        margin_left: { type: "number", description: "Left margin in inches" },
        margin_right: { type: "number", description: "Right margin in inches" },
        timeoutMs: timeoutParam,
      },
      [],
      { timeoutMs: 45_000 },
    ),

    // ── Cookies and storage ──────────────────────────────────────────────────
    obscuraTool(
      "browser_get_cookies",
      "Return all cookies in the browser's cookie jar as one JSON object per line. " +
      "Spanish keywords: ver cookies, obtener cookies, cookies sesión, leer cookies",
      { domain: { type: "string", description: "Filter to cookies on this domain (default: all)" } },
    ),
    obscuraTool(
      "browser_set_cookie",
      "Add or replace a cookie in the jar — skip a login flow when you already have a session token. " +
      "Spanish keywords: setear cookie, establecer cookie, inyectar cookie, cookie sesión",
      {
        name: { type: "string" },
        value: { type: "string" },
        domain: { type: "string", description: "e.g. example.com or .example.com" },
        path: { type: "string", description: "default '/'" },
        secure: { type: "boolean" },
        http_only: { type: "boolean" },
      },
      ["name", "value", "domain"],
    ),
    obscuraTool(
      "browser_clear_cookies",
      "Wipe every cookie from the jar. Spanish keywords: borrar cookies, limpiar cookies, eliminar cookies",
      {},
    ),
    obscuraTool(
      "browser_storage_state",
      "Export the full session state (cookies + localStorage + sessionStorage) as JSON — save it to skip a login on a later run. " +
      "Spanish keywords: exportar sesión, estado sesión, guardar sesión, storage state",
      {},
    ),
    obscuraTool(
      "browser_set_storage_state",
      "Restore a session state previously returned by browser_storage_state to bring an authenticated session back. " +
      "Spanish keywords: restaurar sesión, importar sesión, cargar sesión guardada, login guardado",
      { state: { type: "object", description: "{cookies: [...], origins: [{origin, localStorage: [...], sessionStorage: [...]}]}" } },
      ["state"],
    ),

    // ── Tabs ──────────────────────────────────────────────────────────────────
    obscuraTool(
      "browser_tab_new",
      "Open a new tab (isolated browser page); subsequent tool calls operate on the most recent tab. " +
      "Spanish keywords: nueva pestaña, abrir pestaña, nuevo tab",
      { url: { type: "string", description: "Optional URL to navigate the new tab to" } },
    ),
    obscuraTool(
      "browser_tab_list",
      "List all open tabs with their ID, URL, title and which one is active. " +
      "Spanish keywords: listar pestañas, ver pestañas, tabs abiertos",
      {},
    ),
    obscuraTool(
      "browser_tab_switch",
      "Switch the active tab — all subsequent tool calls target this tab. " +
      "Spanish keywords: cambiar pestaña, cambiar tab, activar pestaña",
      { tab_id: { type: "string", description: "Tab ID from browser_tab_list" } },
      ["tab_id"],
    ),
    obscuraTool(
      "browser_tab_close",
      "Close a tab by ID (default: the active tab). Spanish keywords: cerrar pestaña, cerrar tab",
      { tab_id: { type: "string", description: "Tab ID to close (default: active tab)" } },
    ),
  ]
}

/** Names of every Obscura-backed browser tool (single source of truth). */
export function obscuraToolNames(): string[] {
  return createObscuraTools().map(t => t.name)
}

/** List the tools the Obscura MCP server actually exposes (diagnostics). */
export async function listObscuraTools() {
  if (!obscuraAvailable()) return { ok: false as const, error: INSTALL_ERROR, tools: [] as Array<{ name: string; description?: string; inputSchema?: unknown }> }
  try {
    const tools = await getSession().listTools()
    return { ok: true as const, tools, protocol: getSession().protocolVersion, mode: getSession().protocolMode }
  } catch (err) {
    return { ok: false as const, error: (err as Error).message, tools: [] as Array<{ name: string; description?: string; inputSchema?: unknown }> }
  }
}
