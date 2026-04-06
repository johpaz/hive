/**
 * HiveLearn LLM client — local copy, no core logic dependency.
 * getDb() is still imported from core (shared SQLite DB).
 */

import { logger } from '../utils/logger'
import { GeminiProvider } from './providers/gemini'
import { AnthropicProvider } from './providers/anthropic'
import { OllamaProvider } from './providers/ollama'
import { OpenAICompatProvider } from './providers/openai-compat'
import type { LLMProvider } from './interface'

const log = logger.child('llm-client')

export type { LLMCallOptions, LLMResponse, LLMMessage, LLMToolDef, LLMToolCall } from './interface'

const GEMINI_PROVIDERS = new Set(['gemini', 'google'])

function getProvider(provider: string): LLMProvider {
  if (GEMINI_PROVIDERS.has(provider)) return new GeminiProvider()
  if (provider === 'anthropic') return new AnthropicProvider()
  if (provider === 'ollama') return new OllamaProvider()
  return new OpenAICompatProvider()
}

export async function callLLM(
  options: import('./interface').LLMCallOptions
): Promise<import('./interface').LLMResponse> {
  try {
    return await getProvider(options.provider).call(options)
  } catch (err) {
    const msg = (err as Error).message
    const cleanModel = options.model.replace(new RegExp(`^${options.provider}\\/`), '')
    log.error(`[llm-client] Error calling ${options.provider}/${cleanModel}: ${msg}`)
    return { content: `[LLM Error] ${msg}`, stop_reason: 'error' }
  }
}

export async function resolveProviderConfig(
  providerId: string,
  modelId: string
): Promise<Pick<import('./interface').LLMCallOptions, 'provider' | 'model' | 'apiKey' | 'baseUrl' | 'numCtx' | 'numGpu'>> {
  const { getDb } = await import('@johpaz/hive-agents-core/storage/sqlite')
  const { decryptApiKey } = await import('../crypto/decrypt')

  const db = getDb()
  const providerRow = db
    .query<any, [string]>('SELECT * FROM providers WHERE id = ? AND enabled = 1')
    .get(providerId)

  let apiKey = ''
  if (providerRow?.api_key_encrypted && providerRow?.api_key_iv) {
    try { apiKey = await decryptApiKey(providerRow.api_key_encrypted, providerRow.api_key_iv) } catch { /* fall through */ }
  }
  if (!apiKey) apiKey = process.env[`${providerId.toUpperCase()}_API_KEY`] || ''

  return {
    provider: providerId,
    model: modelId,
    apiKey,
    baseUrl: providerRow?.base_url || undefined,
    numCtx: providerRow?.num_ctx ?? undefined,
    numGpu: providerRow?.num_gpu ?? undefined,
  }
}
