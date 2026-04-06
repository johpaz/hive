/**
 * HiveLearn LLM — shared types and utilities (local copy)
 */

import { logger } from '../utils/logger'
const log = logger.child('llm-client')

// ─── Canonical types ────────────────────────────────────────────────────────────

export interface LLMToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
  thought_signature?: string
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: LLMToolCall[]
  tool_call_id?: string
  name?: string
  reasoning_content?: string
}

export interface LLMToolDef {
  type: 'function'
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
  stop_reason: 'stop' | 'tool_calls' | 'max_tokens' | 'error'
  usage?: { input_tokens: number; output_tokens: number }
  reasoning_content?: string
}

// ─── Provider interface ─────────────────────────────────────────────────────────

export interface LLMProvider {
  call(options: LLMCallOptions): Promise<LLMResponse>
}

// ─── Shared constants ─────────────────────────────────────────────────────────

export const FIXED_TEMPERATURE_1_MODELS = new Set(['kimi-k2.5', 'kimi-k2', 'kimi-k2-5'])

export const OPENAI_COMPAT_BASE_URLS: Record<string, string> = {
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
  kimi: 'https://api.moonshot.ai/v1',
}

export function requiresTemperature1(provider: string, model: string): boolean {
  if (FIXED_TEMPERATURE_1_MODELS.has(model)) return true
  if (provider === 'kimi') {
    const m = model.toLowerCase()
    if (m.includes('k2')) return true
  }
  return false
}

export function sanitizeMessages(messages: LLMMessage[]): LLMMessage[] {
  const knownToolCallIds = new Set<string>()
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      for (const tc of m.tool_calls) knownToolCallIds.add(tc.id)
    }
  }

  const deadIds = new Set<string>()
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'assistant' || !m.tool_calls?.length) continue
    const neededIds = new Set(m.tool_calls.map((tc) => tc.id))
    let j = i + 1
    while (j < messages.length && messages[j].role === 'tool') {
      if (messages[j].tool_call_id) neededIds.delete(messages[j].tool_call_id!)
      j++
    }
    if (neededIds.size > 0) {
      log.warn(`[llm-client] Stripping orphaned tool_calls (missing results for: ${[...neededIds].join(', ')})`)
      for (const tc of m.tool_calls) deadIds.add(tc.id)
    }
  }

  const result: LLMMessage[] = []
  for (const m of messages) {
    if (m.role === 'tool' && m.tool_call_id) {
      if (deadIds.has(m.tool_call_id) || !knownToolCallIds.has(m.tool_call_id)) {
        log.warn(`[llm-client] Dropping orphaned tool result (tool_call_id: ${m.tool_call_id})`)
        continue
      }
    }
    if (m.role === 'assistant' && m.tool_calls?.some((tc) => deadIds.has(tc.id))) {
      const { tool_calls, ...rest } = m
      if (rest.content?.trim()) result.push(rest as LLMMessage)
      continue
    }
    result.push(m)
  }
  return result
}
