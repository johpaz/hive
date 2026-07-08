import { logger } from "../../utils/logger"
import { OpenAICompatBase } from "./openai-compat-base"
import type { LLMCallOptions, LLMResponse } from "./interface"

const log = logger.child("llm-client")

const DEFAULT_BASE = "https://llm.hiveagents.io"

/** Contexto por defecto que se solicita al backend de HiveAgents al cargar un modelo. */
export const HIVEAGENTS_DEFAULT_LOAD_CTX = 50000

// Cloudflare blocks requests with the OpenAI SDK User-Agent and x-stainless-* fingerprint headers.
const BLOCKED_HEADERS = [
  "user-agent",
  "x-stainless-lang",
  "x-stainless-package-version",
  "x-stainless-runtime",
  "x-stainless-runtime-version",
  "x-stainless-arch",
  "x-stainless-os",
]

export interface HiveAgentsLoadResult {
  success: boolean
  loading?: boolean
  error?: string
}

export interface HiveAgentsStatusResult {
  loaded: boolean
  model?: { name?: string; ctx?: number; n_ctx?: number }
}

function getApiBase(baseUrl?: string): string {
  return (baseUrl?.replace(/\/v1\/?$/, "") || DEFAULT_BASE)
}

function getAuthHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  }
}

/**
 * Solicita la carga de un modelo GGUF en el backend de HiveAgents.
 * Siempre pide ctx=HIVEAGENTS_LOAD_CTX para maximizar la ventana de contexto disponible.
 */
/** Timeout para la petición de carga. Menor al límite de Cloudflare (100s) para evitar 524. */
const HIVEAGENTS_LOAD_FETCH_TIMEOUT_MS = 90000

export async function loadHiveAgentsModel(
  modelId: string,
  apiKey: string,
  baseUrl?: string,
  ctx = HIVEAGENTS_DEFAULT_LOAD_CTX
): Promise<HiveAgentsLoadResult> {
  const apiBase = getApiBase(baseUrl)
  const headers = getAuthHeaders(apiKey)
  const loadBody = {
    model: modelId,
    config: { ctx },
  }

  try {
    log.info(`[hiveagents] → POST ${apiBase}/api/load`)
    log.info(`[hiveagents] → Body: ${JSON.stringify(loadBody)}`)
    const res = await fetch(`${apiBase}/api/load`, {
      method: "POST",
      headers,
      body: JSON.stringify(loadBody),
      signal: AbortSignal.timeout(HIVEAGENTS_LOAD_FETCH_TIMEOUT_MS),
    })
    const responseText = await res.text().catch(() => "")
    if (!res.ok) {
      // 524 = Cloudflare timeout. El backend puede seguir cargando, así que lo tratamos como "en progreso".
      // 530 = Cloudflare Tunnel error (origen no resoluble); también puede ser transitorio.
      const isTransientCloudflareError = [502, 503, 504, 524, 530].includes(res.status)
      if (isTransientCloudflareError) {
        log.warn(`[hiveagents] ← Load request hit transient error (HTTP ${res.status}); backend may still be loading`)
        return { success: true, loading: true }
      }
      log.error(`[hiveagents] ← Load failed: HTTP ${res.status} ${res.statusText} — ${responseText}`)
      return { success: false, error: `Load failed: HTTP ${res.status} — ${responseText || res.statusText}` }
    }
    log.info(`[hiveagents] ← Load accepted: ${responseText}`)
    return { success: true }
  } catch (err) {
    const msg = (err as Error).message || ""
    // AbortError por timeout interno: el backend puede seguir cargando.
    if (msg.includes("timed out") || msg.includes("abort") || msg.includes("AbortError")) {
      log.warn(`[hiveagents] ← Load request timed out after ${HIVEAGENTS_LOAD_FETCH_TIMEOUT_MS}ms; backend may still be loading`)
      return { success: true, loading: true }
    }
    return { success: false, error: msg }
  }
}

/**
 * Consulta el estado actual del backend de HiveAgents.
 */
export async function getHiveAgentsModelStatus(
  apiKey: string,
  baseUrl?: string
): Promise<HiveAgentsStatusResult> {
  const apiBase = getApiBase(baseUrl)
  const headers = getAuthHeaders(apiKey)

  try {
    const res = await fetch(`${apiBase}/api/status`, { headers })
    if (!res.ok) return { loaded: false }
    const data = await res.json() as any
    return {
      loaded: !!data.loaded,
      model: data.model,
    }
  } catch {
    return { loaded: false }
  }
}

export class HiveAgentsProvider extends OpenAICompatBase {
  private _currentModelId = ""

  constructor() { super("hiveagents") }

  private _isGemma4(modelId: string): boolean { return /^gemma-?4/i.test(modelId) }
  private _isQwen3(modelId: string): boolean { return /^qwen3?/i.test(modelId) }
  private _isAgentWorld(modelId: string): boolean { return /agentworld/i.test(modelId) }

  // Cloudflare WAF blocks requests carrying x-stainless-* headers from the OpenAI SDK.
  // Strip them via a custom fetch wrapper so they never reach the WAF.
  protected async resolveOpenAIClient(apiKey: string, baseURL: string | undefined): Promise<any> {
    const { default: OpenAI } = await import("openai")
    return new OpenAI({
      apiKey,
      baseURL,
      fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers as HeadersInit | undefined)
        for (const h of BLOCKED_HEADERS) headers.delete(h)

        // Debug: log exact request so we can replicate with curl
        const headersObj: Record<string, string> = {}
        headers.forEach((v, k) => { headersObj[k] = k.toLowerCase() === "authorization" ? `Bearer ••••${v.slice(-6)}` : v })
        log.info(`[hiveagents] → POST ${url}`)
        log.info(`[hiveagents] → Headers: ${JSON.stringify(headersObj)}`)
        if (init?.body) {
          try {
            const parsed = JSON.parse(init.body as string)
            const summary = { model: parsed.model, messages: parsed.messages?.length, tools: parsed.tools?.length, max_tokens: parsed.max_tokens, temperature: parsed.temperature, tool_choice: parsed.tool_choice, extra_body: parsed.extra_body }
            log.info(`[hiveagents] → Body summary: ${JSON.stringify(summary)}`)
          } catch { /* ignore */ }
        }

        const res = await fetch(url, { ...init, headers })
        log.info(`[hiveagents] ← Response: ${res.status} ${res.statusText}`)
        return res
      },
    })
  }

  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const realModelId = options.model.replace(/^hiveagents\//i, "")
    if (realModelId && realModelId !== "local") {
      await this._ensureModelLoaded(realModelId, options)
    }
    this._currentModelId = realModelId

    let callOptions = { ...options, model: "hiveagents/local" }

    // Qwen3: inject /no_think when thinking is explicitly disabled
    if (this._isQwen3(realModelId) && options.thinking?.enabled === false) {
      const msgs = callOptions.messages.map(m => ({ ...m }))
      const sysMsg = msgs.find(m => m.role === "system")
      if (sysMsg && typeof sysMsg.content === "string") {
        if (!sysMsg.content.startsWith("/no_think"))
          sysMsg.content = "/no_think\n" + sysMsg.content
      } else {
        msgs.unshift({ role: "system", content: "/no_think" })
      }
      callOptions = { ...callOptions, messages: msgs }
    }

    return super.call(callOptions)
  }

  // Gemma 4 and Qwen-AgentWorld: inject chat_template_kwargs.enable_thinking via extra_body.
  // Default is true (thinking ON) when options.thinking is not set.
  protected modifyRequestBody(body: any, options: LLMCallOptions): any {
    if (this._isGemma4(this._currentModelId) || this._isAgentWorld(this._currentModelId)) {
      const enableThinking = options.thinking?.enabled !== false
      body.extra_body = {
        ...(body.extra_body ?? {}),
        chat_template_kwargs: { enable_thinking: enableThinking },
      }
    }
    return body
  }

  /**
   * Fallback defensivo: si la UI no cargó el modelo previamente,
   * lo intenta cargar justo antes de inferir.
   */
  private async _ensureModelLoaded(modelId: string, options: LLMCallOptions): Promise<void> {
    const status = await getHiveAgentsModelStatus(options.apiKey, options.baseUrl)
    if (status.loaded && status.model?.name === modelId) {
      log.info(`[hiveagents] Model ${modelId} already loaded`)
      return
    }
    log.warn(`[hiveagents] Model ${modelId} not loaded. Triggering load with ctx=${HIVEAGENTS_DEFAULT_LOAD_CTX}`)
    const result = await loadHiveAgentsModel(modelId, options.apiKey, options.baseUrl)
    if (!result.success) {
      log.warn(`[hiveagents] Auto-load failed for ${modelId}: ${result.error}`)
    }
  }

  protected injectToolsIntoPrompt(body: any, preparedTools: any[]): void {
    // When the backend already receives native OpenAI-style tools, do not confuse
    // the model with an alternate <tool_call> text format. HiveAgents supports
    // native tool_calls when the model/chat-template supports them.
    if (body.tools && body.tools.length > 0) {
      return
    }

    // Fallback for models/backends that do not expose native tool calling:
    // inject the tool descriptions as text and instruct the model to emit
    // a single JSON block wrapped in <tool_call> tags.
    const toolDescriptions = preparedTools.map(t => JSON.stringify(t.function)).join("\n")
    const instruction = [
      "You have access to the following tools.",
      "When you need to use a tool, output EXACTLY one JSON block wrapped in <tool_call> tags and NOTHING ELSE in that turn:",
      "",
      "<tool_call>",
      '{"name": "browser_navigate", "arguments": {"url": "https://example.com"}}',
      "</tool_call>",
      "",
      "Use the exact tool name and argument names from the list below. Do not add extra text, markdown, or explanations inside the tool_call block.",
      "",
      "Tools:",
      toolDescriptions,
    ].join("\n")
    const sysMsg = body.messages.find((m: any) => m.role === "system")
    if (sysMsg) {
      sysMsg.content += "\n\n" + instruction
    } else {
      body.messages.unshift({ role: "system", content: instruction })
    }
  }
}
