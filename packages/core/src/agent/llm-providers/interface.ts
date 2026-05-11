/**
 * Shared types and utilities for LLM providers.
 */

import type { LLMCallOptions, LLMMessage, LLMResponse, LLMToolCall, ContentPart } from "../llm-client"
export type { LLMCallOptions, LLMMessage, LLMResponse, LLMToolCall, ContentPart }

import { logger } from "../../utils/logger"
const log = logger.child("llm-client")

// ─── Provider interface ────────────────────────────────────────────────────────

export interface LLMProvider {
  call(options: LLMCallOptions): Promise<LLMResponse>
}

// ─── Shared constants ─────────────────────────────────────────────────────────

// Models that only accept temperature=1 (reasoning/thinking models).
export const FIXED_TEMPERATURE_1_MODELS = new Set(["kimi-k2.5", "kimi-k2", "kimi-k2-5"])

export const OPENAI_COMPAT_BASE_URLS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  deepseek: "https://api.deepseek.com/v1",
  kimi: "https://api.moonshot.ai/v1",
  "local-llama": "http://localhost:8081/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
}

// ─── Provider profiles ────────────────────────────────────────────────────────

export interface ProviderProfile {
  /** Normalize tool names to strict OpenAI format: [a-zA-Z0-9_-]{1,64} */
  normalizeToolNames: boolean
  /** Replacement string for invalid tool name chars, e.g. "__" */
  toolNameReplacement: string
  /** Value for the tool_choice parameter ("auto" | "any" for Mistral) */
  toolChoiceAuto: string
  /** Send parallel_tool_calls: false when true */
  disableParallelToolCalls: boolean
  /** Strip additionalProperties: false from tool parameter schemas */
  stripAdditionalProperties: boolean
  /** Retry the call without tools when these HTTP status codes are returned */
  retryWithoutToolsOnCodes: number[]
}

const DEFAULT_PROFILE: ProviderProfile = {
  normalizeToolNames: false,
  toolNameReplacement: "__",
  toolChoiceAuto: "auto",
  disableParallelToolCalls: false,
  stripAdditionalProperties: false,
  retryWithoutToolsOnCodes: [],
}

export const PROVIDER_PROFILES: Record<string, ProviderProfile> = {
  openai: { ...DEFAULT_PROFILE, normalizeToolNames: true },
  kimi: { ...DEFAULT_PROFILE, normalizeToolNames: true, disableParallelToolCalls: true, retryWithoutToolsOnCodes: [422] },
  deepseek: { ...DEFAULT_PROFILE, normalizeToolNames: true },
  groq: { ...DEFAULT_PROFILE, normalizeToolNames: true, retryWithoutToolsOnCodes: [400, 422] },
  mistral: { ...DEFAULT_PROFILE, normalizeToolNames: true, toolChoiceAuto: "any", stripAdditionalProperties: true },
  openrouter: { ...DEFAULT_PROFILE, normalizeToolNames: true, retryWithoutToolsOnCodes: [400, 422] },
  nvidia: { ...DEFAULT_PROFILE, normalizeToolNames: true },
  qwen: { ...DEFAULT_PROFILE, normalizeToolNames: true, retryWithoutToolsOnCodes: [400, 422] },
  "local-llama": { ...DEFAULT_PROFILE },
}

export function getProviderProfile(provider: string): ProviderProfile {
  return PROVIDER_PROFILES[provider] ?? DEFAULT_PROFILE
}

// ─── Models that don't support tool calling ───────────────────────────────────

export const NO_TOOL_MODELS = new Set([
  "deepseek-reasoner",
  "deepseek/deepseek-r1:free",
])

export function modelSupportsTools(provider: string, model: string): boolean {
  if (NO_TOOL_MODELS.has(model)) return false
  // DeepSeek R1 and OpenRouter-routed R1 variants don't support tools
  if ((provider === "deepseek" || provider === "openrouter") && /[-/]r1\b/i.test(model)) return false
  return true
}

// ─── Tool name & schema normalization ────────────────────────────────────────

const OPENAI_TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/
const NORMALIZE_CHARS_RE = /[^a-zA-Z0-9_-]/g

/** Normalize a tool name to pass strict [a-zA-Z0-9_-]{1,64} validation. */
export function normalizeToolName(name: string, replacement: string): string {
  if (OPENAI_TOOL_NAME_RE.test(name)) return name
  const escapedReplacement = replacement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const collapseRE = new RegExp(`(${escapedReplacement}){2,}`, "g")
  let n = name.replace(NORMALIZE_CHARS_RE, replacement).replace(collapseRE, replacement)
  if (!/^[a-zA-Z_]/.test(n)) n = "_" + n
  return n.slice(0, 64)
}

/** Strip provider-incompatible fields from a tool parameter schema. */
export function normalizeToolSchema(
  schema: Record<string, unknown>,
  profile: ProviderProfile
): Record<string, unknown> {
  if (!profile.stripAdditionalProperties) return schema
  return deepStripSchema(schema)
}

function deepStripSchema(obj: unknown): any {
  if (typeof obj !== "object" || obj === null) return obj
  if (Array.isArray(obj)) return obj.map(deepStripSchema)
  const result: any = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === "additionalProperties" && v === false) continue
    result[k] = deepStripSchema(v)
  }
  return result
}

// ─── Temperature constraints ──────────────────────────────────────────────────

/**
 * Returns true when the model requires temperature=1.
 * Used for Kimi K2 thinking mode which rejects any other temperature.
 */
export function requiresTemperature1(provider: string, model: string): boolean {
  if (FIXED_TEMPERATURE_1_MODELS.has(model)) return true
  if (provider === "kimi") {
    const m = model.toLowerCase()
    if (m.includes("k2")) return true
  }
  return false
}

// ─── Message sanitization ─────────────────────────────────────────────────────

/**
 * Remove tool_calls from assistant messages whose corresponding tool results
 * are missing from the history (e.g. cleared by compaction). Providers like
 * Kimi reject message sequences with orphaned tool_calls.
 */
export function sanitizeMessages(messages: LLMMessage[]): LLMMessage[] {
  // Pass 0: collect all tool_call_ids that appear in assistant messages.
  const knownToolCallIds = new Set<string>()
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls?.length) {
      for (const tc of m.tool_calls) knownToolCallIds.add(tc.id)
    }
  }

  // Pass 1: determine which tool_call_ids are "dead"
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
      if (deadIds.has(m.tool_call_id) || !knownToolCallIds.has(m.tool_call_id)) {
        log.warn(`[llm-client] Dropping orphaned tool result (tool_call_id: ${m.tool_call_id})`)
        continue
      }
    }
    if (m.role === "assistant" && m.tool_calls?.some((tc) => deadIds.has(tc.id))) {
      const { tool_calls, ...rest } = m
      const hasContent = typeof rest.content === "string"
        ? rest.content.trim()
        : Array.isArray(rest.content) && rest.content.length > 0
      if (hasContent) result.push(rest as LLMMessage)
      continue
    }
    result.push(m)
  }

  return result
}
