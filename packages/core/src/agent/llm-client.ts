/**
 * LLM client — direct official SDKs, no abstraction layers.
 *
 *   gemini / google  → native Gemini REST API (v1beta, ?key=)
 *   anthropic        → @anthropic-ai/sdk
 *   everything else  → openai  npm package  (OpenAI-compatible endpoint)
 *
 * Public interface (LLMMessage, callLLM, resolveProviderConfig) is stable.
 */

import { logger } from "../utils/logger"

const log = logger.child("llm-client")

// ─── Canonical types ───────────────────────────────────────────────────────────

export interface LLMToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
  /** Gemini 3.x thought signature — must be round-tripped for tool-calling. */
  thought_signature?: string
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  tool_calls?: LLMToolCall[]
  tool_call_id?: string
  name?: string
  /** Kimi K2 thinking mode — must be round-tripped when tool calls are present. */
  reasoning_content?: string
}

export interface LLMToolDef {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface LLMCallOptions {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  numCtx?: number
  messages: LLMMessage[]
  tools?: LLMToolDef[]
  temperature?: number
  maxTokens?: number
  numGpu?: number
  onToken?: (token: string) => void
}

export interface LLMResponse {
  content: string
  tool_calls?: LLMToolCall[]
  stop_reason: "stop" | "tool_calls" | "max_tokens" | "error"
  usage?: { input_tokens: number; output_tokens: number }
  /** Kimi K2 thinking mode — must be round-tripped in assistant messages. */
  reasoning_content?: string
}

// ─── Message sanitization ──────────────────────────────────────────────────────

/**
 * Remove tool_calls from assistant messages whose corresponding tool results
 * are missing from the history (e.g. cleared by compaction). Providers like
 * Kimi reject message sequences with orphaned tool_calls.
 */
function sanitizeMessages(messages: LLMMessage[]): LLMMessage[] {
  // Pass 0: collect all tool_call_ids that appear in assistant messages.
  // Tool results whose ID is not in this set are orphans from compaction.
  const knownToolCallIds = new Set<string>()
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls?.length) {
      for (const tc of m.tool_calls) knownToolCallIds.add(tc.id)
    }
  }

  // Pass 1: determine which tool_call_ids are "dead" (their assistant message
  // will be stripped because some results are missing immediately after them).
  const deadIds = new Set<string>()

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== "assistant" || !m.tool_calls?.length) continue

    const neededIds = new Set(m.tool_calls.map((tc) => tc.id))
    let j = i + 1
    while (j < messages.length && messages[j].role === "tool") {
      if (messages[j].tool_call_id) neededIds.delete(messages[j].tool_call_id!)
      j++
    }
    if (neededIds.size > 0) {
      log.warn(`[llm-client] Stripping orphaned tool_calls (missing results for: ${[...neededIds].join(", ")})`)
      for (const tc of m.tool_calls) deadIds.add(tc.id)
    }
  }

  // Pass 2: rebuild message list, dropping/fixing affected messages
  const result: LLMMessage[] = []
  for (const m of messages) {
    if (m.role === "tool" && m.tool_call_id) {
      // Drop if its assistant was stripped (deadIds) OR if the assistant
      // was compacted away entirely (not in knownToolCallIds)
      if (deadIds.has(m.tool_call_id) || !knownToolCallIds.has(m.tool_call_id)) {
        log.warn(`[llm-client] Dropping orphaned tool result (tool_call_id: ${m.tool_call_id})`)
        continue
      }
    }
    if (m.role === "assistant" && m.tool_calls?.some((tc) => deadIds.has(tc.id))) {
      // Strip tool_calls; keep only if there's still text content
      const { tool_calls, ...rest } = m
      if (rest.content?.trim()) result.push(rest as LLMMessage)
      continue
    }
    result.push(m)
  }

  return result
}

// ─── Provider routing ──────────────────────────────────────────────────────────

const GEMINI_PROVIDERS = new Set(["gemini", "google"])

// Models that only accept temperature=1 (reasoning/thinking models).
// Kimi K2 and variants: match by substring since model_id may include
// prefix/suffix like "kimi/kimi-k2", "kimi-k2.5", "kimi-k2-5", etc.
const FIXED_TEMPERATURE_1_MODELS = new Set(["kimi-k2.5", "kimi-k2", "kimi-k2-5"])

/**
 * Returns true when the model requires temperature=1.
 * Used for Kimi K2 thinking mode which rejects any other temperature.
 */
function requiresTemperature1(provider: string, model: string): boolean {
  if (FIXED_TEMPERATURE_1_MODELS.has(model)) return true
  // Catch variants stored with provider prefix or dot/dash differences
  if (provider === "kimi") {
    const m = model.toLowerCase()
    if (m.includes("k2")) return true
  }
  return false
}

const OPENAI_COMPAT_BASE_URLS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com/v1",
  kimi: "https://api.moonshot.ai/v1",
}

// ─── Gemini  (@google/genai) ───────────────────────────────────────────────────

async function callGemini(options: LLMCallOptions): Promise<LLMResponse> {
  const { GoogleGenAI } = await import("@google/genai")

  const clientOpts: any = { apiKey: options.apiKey }
  if (options.baseUrl?.trim()) clientOpts.httpOptions = { baseUrl: options.baseUrl.trim() }

  const ai = new GoogleGenAI(clientOpts)

  // Sanitize first: removes orphaned tool_calls and orphaned tool results
  const cleanMessages = sanitizeMessages(options.messages)

  // Build toolCallId → name map for converting tool results
  const toolNameMap = new Map<string, string>()
  for (const msg of cleanMessages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) toolNameMap.set(tc.id, tc.function.name)
    }
  }

  // Convert canonical messages → Gemini Content[]
  let systemText = ""
  const rawContents: any[] = []

  for (const msg of cleanMessages) {
    if (msg.role === "system") {
      systemText += (systemText ? "\n\n" : "") + msg.content
      continue
    }
    if (msg.role === "user") {
      rawContents.push({ role: "user", parts: [{ text: msg.content }] })
      continue
    }
    if (msg.role === "assistant") {
      const parts: any[] = []
      if (msg.content) parts.push({ text: msg.content })
      for (const tc of msg.tool_calls ?? []) {
        const fcPart: any = { functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments || "{}") } }
        if (tc.thought_signature) fcPart.thoughtSignature = tc.thought_signature
        parts.push(fcPart)
      }
      if (parts.length) rawContents.push({ role: "model", parts })
      continue
    }
    if (msg.role === "tool") {
      const fnName = toolNameMap.get(msg.tool_call_id || "") || msg.name || "tool"
      const frPart = { functionResponse: { name: fnName, response: { output: msg.content } } }
      const last = rawContents[rawContents.length - 1]
      if (last?.role === "user" && Array.isArray(last.parts)) {
        last.parts.push(frPart)
      } else {
        rawContents.push({ role: "user", parts: [frPart] })
      }
    }
  }

  // Gemini constraint enforcement: iterate until the array satisfies both invariants:
  //   INV-1: A model turn with functionCall must be immediately preceded by a user turn
  //   INV-2: A user turn with functionResponse must be immediately preceded by a model turn with functionCall
  //   INV-3: No two consecutive model turns
  //
  // Each pass may create new violations (stripping an fc orphans its fr, etc.).
  // Iterating until stable guarantees convergence since each pass reduces parts/turns.
  const contents: any[] = rawContents

  // Strip leading model turns — they have no preceding user turn by definition and
  // would cascade into orphaned functionResponse strips during constraint enforcement.
  while (contents.length > 0 && contents[0].role === "model") {
    log.warn(`[llm-client] Gemini: removed leading model turn (no preceding user turn)`)
    contents.shift()
  }

  let changed = true
  let safetyLimit = 10
  while (changed && safetyLimit-- > 0) {
    changed = false

    for (let i = 0; i < contents.length; i++) {
      const turn = contents[i]
      const prev = i > 0 ? contents[i - 1] : null

      // INV-3: merge consecutive model turns
      if (turn.role === "model" && prev?.role === "model") {
        prev.parts.push(...(turn.parts ?? []))
        contents.splice(i, 1)
        i--
        changed = true
        continue
      }

      // INV-1: model(fc) must come after user
      if (turn.role === "model") {
        const hasFc = turn.parts?.some((p: any) => p.functionCall)
        if (hasFc && prev?.role !== "user") {
          turn.parts = (turn.parts ?? []).filter((p: any) => !p.functionCall)
          log.warn(`[llm-client] Gemini: stripped functionCall not after user turn (i=${i})`)
          if (turn.parts.length === 0) { contents.splice(i, 1); i-- }
          changed = true
          continue
        }
      }

      // INV-2: user(fr) must come after model(fc)
      if (turn.role === "user") {
        const hasFr = turn.parts?.some((p: any) => p.functionResponse)
        const prevHasFc = prev?.role === "model" && prev?.parts?.some((p: any) => p.functionCall)
        if (hasFr && !prevHasFc) {
          turn.parts = (turn.parts ?? []).filter((p: any) => !p.functionResponse)
          log.warn(`[llm-client] Gemini: stripped orphaned functionResponse (i=${i})`)
          if (turn.parts.length === 0) { contents.splice(i, 1); i-- }
          changed = true
          continue
        }
      }
    }
  }

  const config: any = {}
  if (systemText) config.systemInstruction = systemText
  if (options.maxTokens) config.maxOutputTokens = options.maxTokens
  if (options.temperature !== undefined) config.temperature = options.temperature
  if (options.tools?.length) {
    config.tools = [{
      functionDeclarations: options.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    }]
  }

  log.info(`[llm-client] gemini/${options.model} — ${contents.length} turns, ${options.tools?.length ?? 0} tools`)

  const response = await ai.models.generateContent({ model: options.model, contents, config })

  const candidate = response.candidates?.[0]
  const parts: any[] = candidate?.content?.parts ?? []

  let content = ""
  const tool_calls: LLMToolCall[] = []

  for (const part of parts) {
    if (part.text) content += part.text
    if (part.functionCall) {
      tool_calls.push({
        id: crypto.randomUUID(),
        type: "function",
        function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) },
        thought_signature: part.thoughtSignature ?? undefined,
      })
    }
  }

  const stop_reason: LLMResponse["stop_reason"] =
    tool_calls.length > 0 ? "tool_calls"
      : candidate?.finishReason === "MAX_TOKENS" ? "max_tokens"
        : "stop"

  return {
    content,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    stop_reason,
    usage: response.usageMetadata ? {
      input_tokens: response.usageMetadata.promptTokenCount ?? 0,
      output_tokens: response.usageMetadata.candidatesTokenCount ?? 0,
    } : undefined,
  }
}

// ─── Anthropic (@anthropic-ai/sdk) ────────────────────────────────────────────

async function callAnthropic(options: LLMCallOptions): Promise<LLMResponse> {
  const Anthropic = await import("@anthropic-ai/sdk")
  const client = new Anthropic.default({ apiKey: options.apiKey })

  const systemText = options.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n")

  const anthropicMessages: any[] = []

  for (const msg of options.messages) {
    if (msg.role === "system") continue

    if (msg.role === "tool") {
      const block = { type: "tool_result", tool_use_id: msg.tool_call_id, content: msg.content }
      const last = anthropicMessages[anthropicMessages.length - 1]
      if (last?.role === "user" && Array.isArray(last.content)) {
        last.content.push(block)
      } else {
        anthropicMessages.push({ role: "user", content: [block] })
      }
      continue
    }

    if (msg.role === "assistant" && msg.tool_calls?.length) {
      const content: any[] = []
      if (msg.content) content.push({ type: "text", text: msg.content })
      for (const tc of msg.tool_calls) {
        content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || "{}") })
      }
      anthropicMessages.push({ role: "assistant", content })
      continue
    }

    anthropicMessages.push({ role: msg.role, content: msg.content })
  }

  const tools: any[] = (options.tools ?? []).map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }))

  const body: any = {
    model: options.model,
    max_tokens: options.maxTokens ?? 8192,
    messages: anthropicMessages,
  }
  if (systemText) body.system = systemText
  if (tools.length) body.tools = tools

  log.info(`[llm-client] anthropic/${options.model} — ${anthropicMessages.length} msgs, ${tools.length} tools`)

  const response = await client.messages.create(body)

  let content = ""
  const tool_calls: LLMToolCall[] = []

  for (const block of response.content) {
    if (block.type === "text") content = block.text
    if (block.type === "tool_use") {
      tool_calls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      })
    }
  }

  return {
    content,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    stop_reason:
      response.stop_reason === "tool_use" ? "tool_calls"
        : response.stop_reason === "max_tokens" ? "max_tokens"
          : "stop",
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  }
}

// ─── Ollama (sdk nativo) ──────────────────────────────────────────────────────

async function callOllama(options: LLMCallOptions): Promise<LLMResponse> {
  const { Ollama } = await import("ollama")

  // Limpiar el prefijo "ollama/" del modelo si viene del DB
  const modelName = options.model.replace(/^ollama\//, "")
  const host = options.baseUrl?.trim() || "http://localhost:11434"

  try {
    // Detectar Cloud API de Ollama (ollama.com) → usar Authorization header
    const isCloud = host.includes("ollama.com")
    const headers: Record<string, string> = {}
    if (isCloud && options.apiKey) {
      headers["Authorization"] = `Bearer ${options.apiKey}`
    }

    const client = new Ollama({
      host,
      ...(Object.keys(headers).length ? { headers } : {}),
    })

    // Convertir mensajes al formato que espera Ollama:
    // - assistant con tool_calls → incluir tool_calls con arguments como objeto (no string)
    // - tool result → role:"tool", content (sin tool_call_id, Ollama no lo usa)
    const messages = sanitizeMessages(options.messages).map((m): any => {
      if (m.role === "assistant" && m.tool_calls?.length) {
        return {
          role: "assistant",
          content: m.content || "",
          tool_calls: m.tool_calls.map((tc) => ({
            function: {
              name: tc.function.name,
              arguments: (() => {
                try { return JSON.parse(tc.function.arguments) } catch { return {} }
              })(),
            },
          })),
        }
      }
      if (m.role === "tool") {
        return { role: "tool", content: m.content }
      }
      return { role: m.role, content: m.content }
    })

    // Convertir tools al formato Ollama (igual que OpenAI function-calling)
    const tools = options.tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }))

    // Opciones de runtime (num_ctx para contextos grandes)
    const runtimeOptions: Record<string, unknown> = {}
    if (options.numCtx) runtimeOptions.num_ctx = options.numCtx
    if (options.numGpu !== undefined) runtimeOptions.num_gpu = options.numGpu
    if (options.temperature !== undefined) runtimeOptions.temperature = options.temperature

    log.info(
      `[llm-client] ollama/${modelName} @ ${isCloud ? "ollama.com" : host} stream=true` +
      ` — ${messages.length} msgs, ${tools?.length ?? 0} tools` +
      (options.numCtx ? ` num_ctx=${options.numCtx}` : "")
    )

    // ── Streaming ───────────────────────────────────────────────────────────────
    const stream = await client.chat({
      model: modelName,
      messages,
      tools: tools?.length ? tools : undefined,
      options: Object.keys(runtimeOptions).length ? runtimeOptions : undefined,
      stream: true,
    })

    let content = ""
    let promptEvalCount = 0
    let evalCount = 0
    const tool_calls: LLMToolCall[] = []

    for await (const part of stream) {
      // Acumular texto parcial
      const delta = part.message?.content ?? ""
      if (delta) {
        content += delta
        if (options.onToken) options.onToken(delta)
      }

      // tool_calls solo llegan en el último chunk
      if (part.message?.tool_calls?.length) {
        for (const tc of part.message.tool_calls) {
          tool_calls.push({
            id: crypto.randomUUID(),
            type: "function" as const,
            function: {
              name: (tc as any).function.name,
              arguments: JSON.stringify((tc as any).function.arguments ?? {}),
            },
          })
        }
      }

      // Tokens de uso en el chunk final
      if (part.prompt_eval_count !== undefined) promptEvalCount = part.prompt_eval_count
      if (part.eval_count !== undefined) evalCount = part.eval_count
    }

    return {
      content,
      tool_calls: tool_calls.length ? tool_calls : undefined,
      stop_reason: tool_calls.length > 0 ? "tool_calls" : "stop",
      usage:
        evalCount > 0
          ? { input_tokens: promptEvalCount, output_tokens: evalCount }
          : undefined,
    }
  } catch (error: any) {
    // Logger mucho más explícito para errores críticos (especialmente resource issues)
    log.error(`[llm-client] FAILED call to ollama/${modelName} at ${host}`)
    log.error(`[llm-client] Error details: ${error.message || error}`)
    if (options.numCtx) log.error(`[llm-client] Context requested: num_ctx=${options.numCtx}`)
    if (options.tools?.length) log.error(`[llm-client] Tools defined: ${options.tools.length}`)

    // Sugerencia proactiva si es el error típico de Ollama server crash
    if (error.message?.includes("model runner has unexpectedly stopped")) {
      log.warn(`[llm-client] TIP: This usually means Ollama ran out of VRAM/RAM. Try reducing 'num_ctx' or the number of tools.`)
    }

    throw error // Re-throw to be caught by the main callLLM for consistent response
  }
}


// ─── OpenAI-compatible (openai npm package) ────────────────────────────────────

async function callOpenAICompat(options: LLMCallOptions): Promise<LLMResponse> {
  const { default: OpenAI } = await import("openai")

  const baseURL = options.baseUrl?.trim() || OPENAI_COMPAT_BASE_URLS[options.provider] || undefined
  const isLocal = baseURL?.includes("localhost") || baseURL?.includes("127.0.0.1")
  const apiKey = options.apiKey || (isLocal ? "ollama" : "missing-api-key")

  const client = new OpenAI({ apiKey, baseURL })

  const isKimi = options.provider === "kimi"

  // Kimi K2 requires reasoning_content to be round-tripped in assistant messages
  // (thinking mode). Every other OpenAI-compat provider rejects unknown fields —
  // strip reasoning_content from messages before sending.
  const sanitized = sanitizeMessages(options.messages)
  const messagesForProvider = isKimi
    ? sanitized
    : sanitized.map(({ reasoning_content: _rc, ...rest }) => rest as LLMMessage)

  const body: any = {
    model: options.provider === "ollama" ? options.model.replace(/^ollama\//, "") : options.model,
    messages: messagesForProvider,
    temperature: requiresTemperature1(options.provider, options.model) ? 1 : (options.temperature ?? 0.7),
  }
  if (options.maxTokens) body.max_tokens = options.maxTokens
  if (options.numCtx && isLocal) body.num_ctx = options.numCtx
  if (options.tools?.length) {
    body.tools = options.tools
    body.tool_choice = "auto"
  }

  log.info(`[llm-client] ${options.provider}/${body.model} — ${options.messages.length} msgs, ${options.tools?.length ?? 0} tools`)

  const response = await client.chat.completions.create(body)
  const choice = response.choices[0]
  const msg = choice.message

  const tool_calls: LLMToolCall[] | undefined = (msg.tool_calls as any[])?.map((tc: any) => ({
    id: tc.id,
    type: "function" as const,
    function: { name: tc.function.name, arguments: tc.function.arguments },
  }))

  return {
    content: msg.content ?? "",
    tool_calls: tool_calls?.length ? tool_calls : undefined,
    reasoning_content: (msg as any).reasoning_content ?? undefined,
    stop_reason:
      choice.finish_reason === "tool_calls" ? "tool_calls"
        : choice.finish_reason === "length" ? "max_tokens"
          : "stop",
    usage: response.usage ? {
      input_tokens: response.usage.prompt_tokens,
      output_tokens: response.usage.completion_tokens,
    } : undefined,
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Call any LLM provider. Returns a canonical LLMResponse regardless of provider.
 */
export async function callLLM(options: LLMCallOptions): Promise<LLMResponse> {
  try {
    if (GEMINI_PROVIDERS.has(options.provider)) return await callGemini(options)
    if (options.provider === "anthropic") return await callAnthropic(options)
    if (options.provider === "ollama") return await callOllama(options)
    return await callOpenAICompat(options)
  } catch (err) {
    const msg = (err as Error).message
    const cleanModel = options.model.replace(new RegExp(`^${options.provider}\\/`), "")
    log.error(`[llm-client] Error calling ${options.provider}/${cleanModel}: ${msg}`)
    return { content: `[LLM Error] ${msg}`, stop_reason: "error" }
  }
}

/**
 * Resolve provider config from DB (decrypts API key).
 */
export async function resolveProviderConfig(
  providerId: string,
  modelId: string
): Promise<Pick<LLMCallOptions, "provider" | "model" | "apiKey" | "baseUrl" | "numCtx" | "numGpu">> {
  const { getDb } = await import("../storage/sqlite")
  const { decryptApiKey } = await import("../storage/crypto")

  const db = getDb()
  const providerRow = db
    .query<any, [string]>("SELECT * FROM providers WHERE id = ? AND enabled = 1")
    .get(providerId)

  let apiKey = ""
  if (providerRow?.api_key_encrypted && providerRow?.api_key_iv) {
    try {
      apiKey = await decryptApiKey(providerRow.api_key_encrypted, providerRow.api_key_iv)
    } catch { /* fall through to env var */ }
  }
  if (!apiKey) {
    apiKey = process.env[`${providerId.toUpperCase()}_API_KEY`] || ""
  }

  return {
    provider: providerId,
    model: modelId,
    apiKey,
    baseUrl: providerRow?.base_url || undefined,
    numCtx: providerRow?.num_ctx ?? undefined,
    numGpu: providerRow?.num_gpu ?? undefined,
  }
}
