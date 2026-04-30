/**
 * LLM client — direct official SDKs, no abstraction layers.
 *
 *   gemini / google  → native Gemini REST API (v1beta, ?key=)
 *   anthropic        → @anthropic-ai/sdk
 *   ollama           → ollama npm package
 *   everything else  → openai  npm package  (OpenAI-compatible endpoint)
 *
 * Public interface (LLMMessage, callLLM, resolveProviderConfig) is stable.
 */

import { logger } from "../utils/logger"
import { GeminiProvider } from "./llm-providers/gemini"
import { AnthropicProvider } from "./llm-providers/anthropic"
import { OllamaProvider } from "./llm-providers/ollama"
import { OpenAICompatProvider } from "./llm-providers/openai-compat"
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

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | ContentPart[]
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
}

// ─── Provider factory ─────────────────────────────────────────────────────────

const GEMINI_PROVIDERS = new Set(["gemini", "google"])

const KNOWN_PROVIDERS = new Set(["anthropic", "gemini", "google", "ollama", "openai", "groq", "mistral", "openrouter", "deepseek", "kimi", "local-llama", "nvidia"])

function getProvider(provider: string): LLMProvider {
  if (GEMINI_PROVIDERS.has(provider)) return new GeminiProvider()
  if (provider === "anthropic") return new AnthropicProvider()
  if (provider === "ollama") return new OllamaProvider()
  if (!KNOWN_PROVIDERS.has(provider)) {
    log.warn(`[llm-client] Unknown provider "${provider}" — falling back to OpenAI-compatible endpoint`)
  }
  return new OpenAICompatProvider()
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Call any LLM provider. Returns a canonical LLMResponse regardless of provider.
 */
export async function callLLM(options: LLMCallOptions): Promise<LLMResponse> {
  try {
    return await getProvider(options.provider).call(options)
  } catch (err) {
    const msg = (err as Error).message
    const cleanModel = options.model.replace(new RegExp(`^${options.provider}\\/`), "")
    log.error(`[llm-client] Error calling ${options.provider}/${cleanModel}: ${msg}`, err)
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
