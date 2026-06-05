/**
 * LLM client — direct official SDKs, no abstraction layers.
 *
 *   gemini / google  → native Gemini REST API (v1beta, ?key=)
 *   anthropic        → @anthropic-ai/sdk
 *   ollama           → ollama npm package
 *   openai           → openai npm package
 *   groq / mistral / openrouter / deepseek / kimi / local-llama / nvidia / qwen
 *                    → openai npm package (OpenAI-compatible endpoint, per-provider adapter)
 *
 * Public interface (LLMMessage, callLLM, resolveProviderConfig) is stable.
 */

import { logger } from "../utils/logger"
import { GeminiProvider } from "./llm-providers/gemini"
import { AnthropicProvider } from "./llm-providers/anthropic"
import { OllamaProvider } from "./llm-providers/ollama"
import { OpenAIProvider } from "./llm-providers/openai"
import { GroqProvider } from "./llm-providers/groq"
import { MistralProvider } from "./llm-providers/mistral"
import { OpenRouterProvider } from "./llm-providers/openrouter"
import { DeepSeekProvider } from "./llm-providers/deepseek"
import { KimiProvider } from "./llm-providers/kimi"
import { LocalLlamaProvider } from "./llm-providers/local-llama"
import { NvidiaProvider } from "./llm-providers/nvidia"
import { QwenProvider } from "./llm-providers/qwen"
import { MiniMaxProvider } from "./llm-providers/minimax"
import { OpenCodeGoProvider } from "./llm-providers/opencode-go"
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
  contextWindow?: number
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
    case "local-llama": return new LocalLlamaProvider()
    case "nvidia":      return new NvidiaProvider()
    case "qwen":        return new QwenProvider()
    case "minimax":     return new MiniMaxProvider()
    case "opencode-go": return new OpenCodeGoProvider()
    default:
      log.warn(`[llm-client] Unknown provider "${provider}" — falling back to OpenAI-compatible endpoint`)
      return new OpenAIProvider()
  }
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
): Promise<Pick<LLMCallOptions, "provider" | "model" | "apiKey" | "baseUrl" | "numCtx" | "numGpu" | "contextWindow">> {
  const { getDb } = await import("../storage/sqlite")
  const { loadProviderApiKey } = await import("../storage/crypto")
  const db = getDb()
  const providerRow = db
    .query<any, [string]>("SELECT * FROM providers WHERE id = ? AND enabled = 1")
    .get(providerId)

  // Load model's context window for token budget management
  const modelRow = db
    .query<any, [string]>("SELECT context_window FROM models WHERE id = ?")
    .get(modelId)

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
    contextWindow: modelRow?.context_window ?? undefined,
  }
}
