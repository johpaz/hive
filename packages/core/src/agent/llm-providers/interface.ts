/**
 * Shared types and utilities for LLM providers.
 */

import type { LLMCallOptions, LLMMessage, LLMResponse, LLMToolCall } from "../llm-client"
export type { LLMCallOptions, LLMMessage, LLMResponse, LLMToolCall }

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
}

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
      if (rest.content?.trim()) result.push(rest as LLMMessage)
      continue
    }
    result.push(m)
  }

  return result
}
