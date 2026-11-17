/**
 * Actualiza los modelos de la BD preguntándoselos al propio proveedor.
 *
 * El catálogo estático (`SEED_DATA.models`) envejece: los proveedores publican y retiran modelos sin avisar. Esto
 * consulta el listado del proveedor y guarda lo que declara de cada modelo (tipo, ventana de contexto, capacidades y,
 * cuando lo publica, el precio) como filas `source: "discovered"`, que el resembrado del arranque no borra.
 *
 * Reglas, para que sea seguro correrlo siempre:
 *  - Solo los providers ACTIVOS (`syncActiveProviderModels`); uno concreto solo si se pide (`syncProviderModels`).
 *  - Un modelo NUEVO entra apagado (`enabled: false`): un proveedor puede listar cientos y no se llena la interfaz.
 *    Los locales (Ollama) entran encendidos, como siempre.
 *  - Un modelo que YA existe conserva lo que es del usuario: nombre, `enabled`, `active` y el precio que ya tuviera.
 *    El proveedor es la autoridad de la ventana de contexto y de las capacidades que declara (se suman a las que ya
 *    había; nunca se quita ninguna).
 *  - Un modelo que el proveedor ya NO lista no se borra ni se apaga (podría haber agentes apuntándole): se marca
 *    `unlisted: true` para poder avisarlo, y se desmarca si vuelve a aparecer.
 *  - Un fallo (red, 401, formato raro) no toca nada y se informa por proveedor sin incluir nunca la clave.
 *  - Lo que el proveedor no dice no se inventa: ventana 0 = desconocida, precio `null` = desconocido.
 */
import { col } from "./hive"
import type { ProviderDoc, ModelDoc } from "./collections"
import { catalogModelKey } from "./model-id"
import { loadProviderApiKey, loadProviderHeaders } from "./crypto"
import { logger } from "../utils/logger"

const log = logger.child("model-sync")

type ModelType = ModelDoc["model_type"]

/** Lo que un proveedor declara de un modelo, ya normalizado. */
export interface DiscoveredModel {
  /** Nombre en el cable (sin el prefijo de revendedor). */
  wireId: string
  name?: string
  type?: ModelType
  contextWindow?: number
  capabilities?: string[]
  /** USD por millón de tokens, solo si el proveedor lo publica. */
  inputPer1M?: number
  outputPer1M?: number
}

export interface FetchContext {
  providerId: string
  baseUrl: string | null
  apiKey: string
  headers: Record<string, string>
  fetch: typeof fetch
  timeoutMs: number
}

export type ProviderFetcher = (ctx: FetchContext) => Promise<DiscoveredModel[]>

/** Providers cuyo listado responde sin clave (o que no la usan): se consultan aunque no haya una guardada. */
const KEYLESS = new Set(["ollama", "modelscope"])
/** Providers cuyo listado no es completo por diseño (modelos montados bajo demanda): nunca se marca nada como retirado. */
const PARTIAL_LISTING = new Set(["hiveagents", "piper"])
/** Providers locales: sus modelos son gratis y entran encendidos. */
const LOCAL = new Set(["ollama"])

const MAX_MODELS = 10_000
const MAX_PAGES = 10

class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

async function getJson(ctx: FetchContext, url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await ctx.fetch(url, { headers, signal: AbortSignal.timeout(ctx.timeoutMs) })
  if (!response.ok) throw new ProviderHttpError(response.status)
  return response.json()
}

const trimSlash = (s: string) => s.replace(/\/+$/, "")
const positive = (n: unknown): number | undefined => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined)
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined)

/**
 * Tipo de un modelo cuando el proveedor solo da su id. `null` = no es un tipo que la app maneje (imágenes, moderación…):
 * no se guarda. Solo se usa si el proveedor no declaró nada mejor.
 */
export function classifyModelId(wireId: string): ModelType | null {
  const id = wireId.toLowerCase()
  if (/(^|[-_/])(dall-e|imagen|sora|image|veo|moderation|omni-moderation|guard)([-_/.\d]|$)/.test(id)) return null
  // Modelos auxiliares que no conversan: guardas de seguridad, CLIP, detectores, rerankers, parsers y similares.
  if (/(guard|safety|nvclip|(^|[-_/])clip([-_/.\d]|$)|detector|reward|rerank|retriev|parse|[-_]ocr([-_/.\d]|$))/.test(id)) return null
  if (/embed/.test(id)) return "embedding"
  if (/(whisper|transcribe|scribe|\basr\b|[-_]asr[-_]|stt)/.test(id)) return "stt"
  if (/(realtime|[-_]live([-_.\d]|$))/.test(id)) return "realtime"
  if (/(tts|speech|voxtral)/.test(id)) return "tts"
  return "llm"
}

// ─── Adaptadores ─────────────────────────────────────────────────────────────

/** `GET {base}/models` con `Authorization: Bearer`: OpenAI y casi todos los demás, con las señales extra que den. */
const openAiCompatible: ProviderFetcher = async (ctx) => {
  if (!ctx.baseUrl) throw new Error("el provider no tiene base_url")
  const headers: Record<string, string> = { ...ctx.headers }
  if (ctx.apiKey) headers.Authorization = `Bearer ${ctx.apiKey}`
  const body = (await getJson(ctx, `${trimSlash(ctx.baseUrl)}/models`, headers)) as Record<string, unknown>
  const rows = (Array.isArray(body) ? body : (body.data as unknown[])) ?? []
  const out: DiscoveredModel[] = []
  for (const raw of rows.slice(0, MAX_MODELS)) {
    const row = raw as Record<string, any>
    const wireId = text(row.id) ?? text(row.model_id)
    if (!wireId) continue
    const found: DiscoveredModel = { wireId, name: text(row.display_name) ?? text(row.name) }
    found.contextWindow =
      positive(row.context_length) ?? positive(row.context_window) ?? positive(row.max_context_length) ??
      positive(row.max_model_len) ?? positive(row.top_provider?.context_length)
    // Modalidades declaradas (OpenRouter y compatibles).
    const inputs: unknown[] | undefined = row.architecture?.input_modalities ?? row.input_modalities
    const outputs: unknown[] | undefined = row.architecture?.output_modalities ?? row.output_modalities
    const caps = new Set<string>()
    if (inputs && outputs) {
      if (outputs.includes("image")) continue // generación de imágenes: no se maneja
      if (outputs.includes("audio")) { found.type = "tts"; caps.add("tts"); caps.add("speech") }
      else if (inputs.includes("audio") && !inputs.includes("text")) { found.type = "stt"; caps.add("transcription") }
      else if (outputs.includes("text")) { found.type = "llm"; caps.add("chat") }
      if (inputs.includes("image")) caps.add("vision")
    }
    // Capacidades declaradas (Mistral) y parámetros soportados (OpenRouter).
    const declared = row.capabilities
    if (declared && typeof declared === "object" && !Array.isArray(declared)) {
      if (declared.completion_chat) caps.add("chat")
      if (declared.function_calling) caps.add("function_calling")
      if (declared.vision) caps.add("vision")
    }
    const params: unknown[] | undefined = row.supported_parameters
    if (Array.isArray(params)) {
      if (params.includes("tools")) caps.add("function_calling")
      if (params.includes("response_format") || params.includes("structured_outputs")) caps.add("json_mode")
      if (params.includes("reasoning") || params.includes("include_reasoning")) caps.add("reasoning")
    }
    if (caps.size) found.capabilities = [...caps]
    // Precio publicado (OpenRouter: USD por token, como texto; negativo = variable).
    const prompt = Number(row.pricing?.prompt)
    const completion = Number(row.pricing?.completion)
    if (row.pricing && Number.isFinite(prompt) && prompt >= 0 && Number.isFinite(completion) && completion >= 0) {
      found.inputPer1M = Math.round(prompt * 1e6 * 1e4) / 1e4
      found.outputPer1M = Math.round(completion * 1e6 * 1e4) / 1e4
    }
    out.push(found)
  }
  return out
}

/** Anthropic: `GET /v1/models` con `x-api-key` y su versión de API. */
const anthropic: ProviderFetcher = async (ctx) => {
  const base = trimSlash(ctx.baseUrl || "https://api.anthropic.com").replace(/\/v1$/, "")
  const out: DiscoveredModel[] = []
  let after: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${base}/v1/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ""}`
    const body = (await getJson(ctx, url, { ...ctx.headers, "x-api-key": ctx.apiKey, "anthropic-version": "2023-06-01" })) as any
    for (const row of (body.data as any[]) ?? []) {
      const wireId = text(row.id)
      if (!wireId) continue
      const caps = new Set<string>(["chat"])
      if (row.capabilities?.image_input?.supported) caps.add("vision")
      if (row.capabilities?.structured_outputs?.supported) caps.add("json_mode")
      if (row.capabilities?.thinking?.supported) caps.add("reasoning")
      out.push({ wireId, name: text(row.display_name), type: "llm", contextWindow: positive(row.max_input_tokens), capabilities: [...caps] })
    }
    if (!body.has_more || !body.last_id) break
    after = body.last_id
  }
  return out.slice(0, MAX_MODELS)
}

/** Gemini: `GET /v1beta/models` con `x-goog-api-key`; el tipo sale de los métodos de generación que declara. */
const gemini: ProviderFetcher = async (ctx) => {
  const base = trimSlash(ctx.baseUrl || "https://generativelanguage.googleapis.com/v1beta")
  const out: DiscoveredModel[] = []
  let token: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${base}/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`
    const body = (await getJson(ctx, url, { ...ctx.headers, "x-goog-api-key": ctx.apiKey })) as any
    for (const row of (body.models as any[]) ?? []) {
      const name = text(row.name)
      if (!name) continue
      const wireId = name.replace(/^models\//, "")
      const methods: string[] = Array.isArray(row.supportedGenerationMethods) ? row.supportedGenerationMethods : []
      let type: ModelType | undefined
      const caps = new Set<string>()
      if (methods.includes("bidiGenerateContent")) { type = "realtime"; caps.add("realtime") }
      else if (/tts/.test(wireId)) { type = "tts"; caps.add("tts"); caps.add("speech") }
      else if (methods.includes("generateContent") || methods.includes("streamGenerateContent")) {
        if (/(image|imagen|veo)/.test(wireId)) continue // imágenes y vídeo: no se manejan
        type = "llm"; caps.add("chat"); caps.add("streaming")
      } else if (methods.includes("embedContent") || methods.includes("batchEmbedContents")) type = "embedding"
      else if (methods.includes("predict") || methods.includes("predictLongRunning")) continue
      if (row.thinking === true) caps.add("reasoning")
      out.push({ wireId, name: text(row.displayName), type, contextWindow: positive(row.inputTokenLimit), capabilities: caps.size ? [...caps] : undefined })
    }
    token = text(body.nextPageToken)
    if (!token) break
  }
  return out.slice(0, MAX_MODELS)
}

/** Ollama: `/api/tags` y, por cada modelo, `/api/show` (ventana de contexto y capacidades reales). Gratis por ser local. */
const ollama: ProviderFetcher = async (ctx) => {
  const host = trimSlash(ctx.baseUrl || "http://localhost:11434").replace(/\/(v1|api)$/, "")
  const tags = (await getJson(ctx, `${host}/api/tags`, ctx.headers)) as any
  const names: string[] = ((tags.models as any[]) ?? []).map((m) => text(m.name) ?? text(m.model)).filter((n): n is string => !!n).slice(0, 500)
  const out: DiscoveredModel[] = []
  let next = 0
  const worker = async () => {
    while (next < names.length) {
      const wireId = names[next++]
      const found: DiscoveredModel = { wireId, type: "llm", inputPer1M: 0, outputPer1M: 0 }
      try {
        const response = await ctx.fetch(`${host}/api/show`, {
          method: "POST", headers: { ...ctx.headers, "Content-Type": "application/json" },
          body: JSON.stringify({ model: wireId }), signal: AbortSignal.timeout(ctx.timeoutMs),
        })
        if (response.ok) {
          const info = (await response.json()) as any
          for (const [key, value] of Object.entries(info.model_info ?? {})) {
            if (key.endsWith(".context_length")) { found.contextWindow = positive(value); break }
          }
          const caps = new Set<string>()
          for (const c of (info.capabilities as string[]) ?? []) {
            if (c === "completion") caps.add("chat")
            else if (c === "vision") caps.add("vision")
            else if (c === "tools") caps.add("function_calling")
            else if (c === "thinking") caps.add("reasoning")
            else if (c === "embedding") found.type = "embedding"
          }
          if (caps.size) found.capabilities = [...caps]
        }
      } catch { /* sin detalle: el modelo se guarda igual con lo que dio /api/tags */ }
      out.push(found)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return out
}

/** ElevenLabs: `GET /v1/models` con `xi-api-key`; solo los que sirven para síntesis de voz. */
const elevenlabs: ProviderFetcher = async (ctx) => {
  const base = trimSlash(ctx.baseUrl || "https://api.elevenlabs.io/v1")
  const body = (await getJson(ctx, `${base}/models`, { ...ctx.headers, "xi-api-key": ctx.apiKey })) as any[]
  return (Array.isArray(body) ? body : [])
    .filter((m) => m.can_do_text_to_speech === true && text(m.model_id))
    .map((m) => ({ wireId: m.model_id as string, name: text(m.name), type: "tts" as const, capabilities: ["tts", "speech"] }))
}

const FETCHERS: Record<string, ProviderFetcher> = { anthropic, gemini, ollama, elevenlabs }

/** Consulta el listado del proveedor con el adaptador que le corresponde. */
export async function fetchProviderModels(ctx: FetchContext): Promise<DiscoveredModel[]> {
  return (FETCHERS[ctx.providerId] ?? openAiCompatible)(ctx)
}

// ─── Fusión con la BD ────────────────────────────────────────────────────────

export interface ApplyResult {
  added: number
  updated: number
  /** Marcados como que el proveedor ya no los lista. */
  unlisted: number
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

function parseCapabilities(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : []
  } catch { return [] }
}

/** Guarda lo descubierto en `models` según las reglas del encabezado. */
export async function applyDiscoveredModels(provider: ProviderDoc, found: DiscoveredModel[], now = Date.now()): Promise<ApplyResult> {
  const models = await col<ModelDoc>("models")
  const result: ApplyResult = { added: 0, updated: 0, unlisted: 0 }
  const seen = new Set<string>()
  const local = LOCAL.has(provider.id)

  for (const model of found) {
    const key = catalogModelKey(provider.id, model.wireId)
    if (seen.has(key)) continue
    seen.add(key)
    const type = model.type ?? classifyModelId(model.wireId)
    const row = await models.get(key)
    if (!row) {
      if (type === null) continue // un tipo que la app no maneja
      await models.put(key, {
        id: key, provider_id: provider.id, name: model.name ?? model.wireId, model_type: type,
        context_window: model.contextWindow ?? 0,
        capabilities: model.capabilities?.length ? JSON.stringify(model.capabilities) : null,
        enabled: local, active: false, source: "discovered",
        input_per_1m: model.inputPer1M ?? (local ? 0 : null),
        output_per_1m: model.outputPer1M ?? (local ? 0 : null),
        synced_at: now,
      }, { expectedVersion: 0 })
      result.added++
      continue
    }
    const doc = row.doc
    const next: ModelDoc = { ...doc }
    let changed = false
    if (model.contextWindow && doc.context_window !== model.contextWindow) { next.context_window = model.contextWindow; changed = true }
    if (model.capabilities?.length) {
      const have = parseCapabilities(doc.capabilities)
      const merged = [...new Set([...have, ...model.capabilities])]
      if (!sameSet(have, merged)) { next.capabilities = JSON.stringify(merged); changed = true }
    }
    if ((doc.input_per_1m === null || doc.input_per_1m === undefined) && model.inputPer1M !== undefined) { next.input_per_1m = model.inputPer1M; changed = true }
    if ((doc.output_per_1m === null || doc.output_per_1m === undefined) && model.outputPer1M !== undefined) { next.output_per_1m = model.outputPer1M; changed = true }
    if (doc.unlisted) { delete next.unlisted; changed = true }
    if (changed) {
      next.synced_at = now
      await models.put(key, next, { expectedVersion: row.version })
      result.updated++
    }
  }

  // Lo que el proveedor ya no lista se marca, no se borra. Una lista vacía o parcial por diseño no marca nada.
  if (found.length > 0 && !PARTIAL_LISTING.has(provider.id)) {
    for (const row of await models.findBy("provider_id", provider.id)) {
      if (seen.has(row.id) || row.doc.unlisted) continue
      await models.put(row.id, { ...row.doc, unlisted: true, synced_at: now }, { expectedVersion: row.version })
      result.unlisted++
    }
  }
  return result
}

// ─── Orquestación ────────────────────────────────────────────────────────────

export interface SyncDeps {
  fetch?: typeof fetch
  loadKey?: (providerId: string) => Promise<string>
  loadHeaders?: (providerId: string) => Promise<Record<string, unknown>>
  now?: () => number
  timeoutMs?: number
}

export interface ProviderSyncResult {
  provider: string
  ok: boolean
  /** Por qué no se consultó (sin clave, inactivo…). */
  skipped?: string
  found?: number
  added?: number
  updated?: number
  unlisted?: number
  /** Qué falló, sin la clave ni el cuerpo de la respuesta. */
  error?: string
  /** Código HTTP del proveedor si fue lo que falló. */
  status?: number
}

function stringHeaders(raw: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string")) as Record<string, string>
}

/** Actualiza los modelos de UN provider (sin exigir que esté activo: es lo que pide una persona a mano). */
export async function syncProviderModels(providerId: string, deps: SyncDeps = {}): Promise<ProviderSyncResult> {
  const providers = await col<ProviderDoc>("providers")
  const entry = await providers.get(providerId)
  if (!entry) return { provider: providerId, ok: false, error: "provider desconocido" }
  const apiKey = await (deps.loadKey ?? loadProviderApiKey)(providerId).catch(() => "")
  if (!apiKey && !KEYLESS.has(providerId)) return { provider: providerId, ok: false, skipped: "sin clave guardada" }
  const headers = stringHeaders(await (deps.loadHeaders ?? loadProviderHeaders)(providerId).catch(() => ({})))
  try {
    const found = await fetchProviderModels({
      providerId, baseUrl: entry.doc.base_url, apiKey, headers,
      fetch: deps.fetch ?? fetch, timeoutMs: deps.timeoutMs ?? 10_000,
    })
    if (found.length === 0) return { provider: providerId, ok: false, found: 0, error: "el proveedor no devolvió ningún modelo" }
    const applied = await applyDiscoveredModels(entry.doc, found, (deps.now ?? Date.now)())
    return { provider: providerId, ok: true, found: found.length, ...applied }
  } catch (err) {
    if (err instanceof ProviderHttpError) return { provider: providerId, ok: false, error: `el proveedor respondió ${err.status}`, status: err.status }
    const name = (err as Error).name
    return { provider: providerId, ok: false, error: name === "TimeoutError" || name === "AbortError" ? "el proveedor no respondió a tiempo" : "no se pudo consultar el proveedor" }
  }
}

/** Actualiza los modelos de todos los providers ACTIVOS, de a cuatro a la vez. */
export async function syncActiveProviderModels(deps: SyncDeps = {}): Promise<ProviderSyncResult[]> {
  const providers = await col<ProviderDoc>("providers")
  const active = (await providers.scan({})).filter((p) => p.doc.enabled && p.doc.active).map((p) => p.id)
  const results: ProviderSyncResult[] = []
  let next = 0
  const worker = async () => {
    while (next < active.length) {
      const id = active[next++]
      const result = await syncProviderModels(id, deps)
      if (!result.ok && !result.skipped) log.warn(`[model-sync] ${id}: ${result.error}`)
      results.push(result)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return results.sort((a, b) => a.provider.localeCompare(b.provider))
}
