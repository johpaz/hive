/**
 * LLM client — direct official SDKs, no abstraction layers.
 *
 *   gemini / google  → native Gemini REST API (v1beta, ?key=)
 *   anthropic        → @anthropic-ai/sdk
 *   ollama           → ollama npm package
 *   openai           → openai npm package
 *   groq / mistral / openrouter / deepseek / kimi / nvidia / qwen
 *                    → openai npm package (OpenAI-compatible endpoint, per-provider adapter)
 *
 * Public interface (LLMMessage, callLLM, resolveProviderConfig) is stable.
 */

import { logger } from "../utils/logger"
import { loadConfig } from "../config/loader"
import { withRetry, isRetryableError, type RetryPolicy } from "../resilience/retry"
import { GeminiProvider } from "./llm-providers/gemini"
import { AnthropicProvider } from "./llm-providers/anthropic"
import { OllamaProvider } from "./llm-providers/ollama"
import { OpenAIProvider } from "./llm-providers/openai"
import { GroqProvider } from "./llm-providers/groq"
import { MistralProvider } from "./llm-providers/mistral"
import { OpenRouterProvider } from "./llm-providers/openrouter"
import { DeepSeekProvider } from "./llm-providers/deepseek"
import { KimiProvider } from "./llm-providers/kimi"
import { NvidiaProvider } from "./llm-providers/nvidia"
import { QwenProvider } from "./llm-providers/qwen"
import { MiniMaxProvider } from "./llm-providers/minimax"
import { OpenCodeGoProvider } from "./llm-providers/opencode-go"
import { HiveAgentsProvider } from "./llm-providers/hiveagents"
import { ZaiProvider } from "./llm-providers/z-ai"
import { ModelScopeProvider } from "./llm-providers/modelscope"
import type { LLMProvider } from "./llm-providers/interface"

const log = logger.child("llm-client")

// ─── Canonical types ───────────────────────────────────────────────────────────

export interface LLMToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
  /** Gemini 3.x thought signature — must be round-tripped for tool-calling. */
  thought_signature?: string
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "image_base64"; base64: string; mimeType: string }
  | { type: "document"; base64: string; mimeType: string; fileName?: string }

/** Raw Anthropic extended-thinking content block, round-tripped verbatim (signature required by the API when tool_use follows). */
export interface ThinkingBlock {
  type: "thinking" | "redacted_thinking"
  thinking?: string
  signature?: string
  data?: string
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | ContentPart[]
  tool_calls?: LLMToolCall[]
  tool_call_id?: string
  name?: string
  /** Kimi K2 thinking mode — must be round-tripped when tool calls are present. */
  reasoning_content?: string
  /** Anthropic extended thinking — must be round-tripped verbatim when tool calls are present. */
  thinking_blocks?: ThinkingBlock[]
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
  contextWindow?: number
  messages: LLMMessage[]
  tools?: LLMToolDef[]
  temperature?: number
  maxTokens?: number
  numGpu?: number
  onToken?: (token: string) => void
  /** Live reasoning/thinking tokens as they stream, for display only (never sent back to the LLM). */
  onReasoningToken?: (token: string) => void
  signal?: AbortSignal
  /** Enable extended thinking for supported models (Anthropic Claude 3.7+). */
  thinking?: { enabled: boolean; budget_tokens?: number }
}

export interface LLMResponse {
  content: string
  tool_calls?: LLMToolCall[]
  stop_reason: "stop" | "tool_calls" | "max_tokens" | "error"
  usage?: { input_tokens: number; output_tokens: number; thinking_tokens?: number }
  /** Kimi K2 / DeepSeek thinking mode — must be round-tripped in assistant messages. */
  reasoning_content?: string
  /** Anthropic extended thinking content (not sent to LLM, for display only). */
  thinking_content?: string
  /** Anthropic extended thinking raw blocks — must be round-tripped verbatim when tool calls follow. */
  thinking_blocks?: ThinkingBlock[]
  /**
   * Set only when stop_reason === "error". `content` carries a human-readable
   * version of the same failure for display, but it is NOT model output —
   * callers must check this field before persisting `content` anywhere durable
   * (conversation history, summaries, task results).
   */
  error?: {
    message: string
    status?: number
    /** The model id no longer resolves at the provider (HTTP 404/410) — the config needs to change, retrying won't help. */
    modelUnavailable?: boolean
  }
}

// ─── Provider factory ─────────────────────────────────────────────────────────

function getProvider(provider: string): LLMProvider {
  switch (provider) {
    case "gemini":
    case "google":      return new GeminiProvider()
    case "anthropic":   return new AnthropicProvider()
    case "ollama":      return new OllamaProvider()
    case "openai":      return new OpenAIProvider()
    case "groq":        return new GroqProvider()
    case "mistral":     return new MistralProvider()
    case "openrouter":  return new OpenRouterProvider()
    case "deepseek":    return new DeepSeekProvider()
    case "kimi":        return new KimiProvider()
    case "nvidia":      return new NvidiaProvider()
    case "qwen":        return new QwenProvider()
    case "minimax":     return new MiniMaxProvider()
    case "opencode-go": return new OpenCodeGoProvider()
    case "hiveagents":  return new HiveAgentsProvider()
    case "z-ai":        return new ZaiProvider()
    case "modelscope":  return new ModelScopeProvider()
    default:
      log.warn(`[llm-client] Unknown provider "${provider}" — falling back to OpenAI-compatible endpoint`)
      return new OpenAIProvider()
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Call any LLM provider. Returns a canonical LLMResponse regardless of provider.
 *
 * Retries transient failures (429/5xx/timeout/network) with exponential
 * backoff + jitter per `config.retry`, honoring `Retry-After` when the
 * provider sends one. An aborted signal never retries. Note: this retries
 * the whole call, so a failure that happens mid-stream (after onToken has
 * already fired) can produce a duplicated partial response — acceptable
 * because provider failures overwhelmingly happen before the stream starts
 * (auth/rate-limit/connection errors).
 */
export async function callLLM(options: LLMCallOptions): Promise<LLMResponse> {
  const retryCfg = loadConfig().retry
  const policy: RetryPolicy = {
    maxAttempts: retryCfg?.maxAttempts ?? 3,
    initialDelayMs: retryCfg?.initialDelayMs ?? 1000,
    backoffMultiplier: retryCfg?.backoffMultiplier ?? 2,
    maxDelayMs: retryCfg?.maxDelayMs ?? 30000,
  }
  try {
    return await withRetry(
      () => getProvider(options.provider).call(options),
      policy,
      (err) => !options.signal?.aborted && isRetryableError(err)
    )
  } catch (err) {
    const cleanModel = options.model.replace(new RegExp(`^${options.provider}\\/`), "")
    const status = extractErrorStatus(err)
    const modelUnavailable = status === 404 || status === 410
    const msg = modelUnavailable
      ? `El modelo "${cleanModel}" ya no existe en ${options.provider} (HTTP ${status}). `
        + `El proveedor lo retiró de su catálogo; reintentar no sirve. `
        + `Elegí otro modelo en Ajustes → Proveedores.`
      : (err as Error).message
    log.error(`[llm-client] Error calling ${options.provider}/${cleanModel}: ${msg}`, err)
    return {
      content: `[LLM Error] ${msg}`,
      stop_reason: "error",
      error: { message: msg, status, modelUnavailable },
    }
  }
}

/** Provider SDKs disagree on where the HTTP status lands; check every shape we've seen. */
function extractErrorStatus(err: unknown): number | undefined {
  const e = err as { status?: number; statusCode?: number; response?: { status?: number } }
  return e?.status ?? e?.statusCode ?? e?.response?.status
}

/**
 * Default provider/model resolved from the DB, used when an agent has none configured:
 * 1. the coordinator agent's config, 2. the first active LLM model of an active provider.
 * Returns null when the DB has no usable LLM (e.g. fresh install before setup).
 */
export async function getDefaultLLM(): Promise<{ provider: string; model: string } | null> {
  const { col, fromIndexable } = await import("../storage/hive")
  const agentsCol = await col<import("../storage/collections").AgentDoc>("agents")
  const modelsCol = await col<import("../storage/collections").ModelDoc>("models")
  const providersCol = await col<import("../storage/collections").ProviderDoc>("providers")

  const coordinators = await agentsCol.findBy("role", "coordinator")
  const coordinator = coordinators[0]
  const coordinatorProvider = fromIndexable(coordinator?.doc.provider_id ?? null)
  const coordinatorModel = fromIndexable(coordinator?.doc.model_id ?? null)
  if (coordinatorProvider && coordinatorModel) {
    return { provider: coordinatorProvider, model: coordinatorModel }
  }

  const activeModels = (await modelsCol.findBy("model_type", "llm")).filter(m => m.doc.active)
  for (const m of activeModels) {
    const provider = await providersCol.get(m.doc.provider_id)
    if (provider?.doc.active) {
      return { provider: m.doc.provider_id, model: m.doc.id }
    }
  }
  return null
}

/**
 * Resolve provider config from DB (decrypts API key).
 */
export async function resolveProviderConfig(
  providerId: string,
  modelId: string
): Promise<Pick<LLMCallOptions, "provider" | "model" | "apiKey" | "baseUrl" | "numCtx" | "numGpu" | "contextWindow">> {
  const { col } = await import("../storage/hive")
  const { loadProviderApiKey } = await import("../storage/crypto")
  const providersCol = await col<import("../storage/collections").ProviderDoc>("providers")
  const modelsCol = await col<import("../storage/collections").ModelDoc>("models")

  const providerEntry = await providersCol.get(providerId)
  const providerRow = (providerEntry?.doc.enabled && providerEntry?.doc.active) ? providerEntry.doc : undefined

  // Load model's context window for token budget management
  const modelEntry = await modelsCol.get(modelId)

  let apiKey = await loadProviderApiKey(providerId)
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
    contextWindow: modelEntry?.doc.context_window ?? undefined,
  }
}
