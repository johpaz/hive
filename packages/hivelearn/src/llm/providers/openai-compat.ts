import { logger } from '../../utils/logger'
import { sanitizeMessages, requiresTemperature1, OPENAI_COMPAT_BASE_URLS } from '../interface'
import type { LLMCallOptions, LLMProvider, LLMResponse, LLMToolCall } from '../interface'

const log = logger.child('llm-client')

export class OpenAICompatProvider implements LLMProvider {
  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const { default: OpenAI } = await import('openai')

    const baseURL = options.baseUrl?.trim() || OPENAI_COMPAT_BASE_URLS[options.provider] || undefined
    const isLocal = baseURL?.includes('localhost') || baseURL?.includes('127.0.0.1')
    const apiKey = options.apiKey || (isLocal ? 'ollama' : 'missing-api-key')

    const client = new OpenAI({ apiKey, baseURL })
    const isKimi = options.provider === 'kimi'

    const sanitized = sanitizeMessages(options.messages)
    const messagesForProvider = isKimi
      ? sanitized
      : sanitized.map(({ reasoning_content: _rc, ...rest }) => rest as typeof sanitized[number])

    const providerPrefix = new RegExp(`^${options.provider}\\/`, 'i')
    const body: any = {
      model: options.model.replace(providerPrefix, ''),
      messages: messagesForProvider,
      temperature: requiresTemperature1(options.provider, options.model) ? 1 : (options.temperature ?? 0.7),
    }
    if (options.maxTokens) body.max_tokens = options.maxTokens
    if (options.numCtx && isLocal) body.num_ctx = options.numCtx
    if (options.tools?.length) { body.tools = options.tools; body.tool_choice = 'auto' }

    log.info(`[llm-client] ${options.provider}/${body.model} — ${options.messages.length} msgs, ${options.tools?.length ?? 0} tools`)

    const response = await client.chat.completions.create(body)
    const choice = response.choices[0]
    const msg = choice.message

    const tool_calls: LLMToolCall[] | undefined = (msg.tool_calls as any[])?.map((tc: any) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }))

    return {
      content: msg.content ?? '',
      tool_calls: tool_calls?.length ? tool_calls : undefined,
      reasoning_content: (msg as any).reasoning_content ?? undefined,
      stop_reason:
        choice.finish_reason === 'tool_calls' ? 'tool_calls'
          : choice.finish_reason === 'length' ? 'max_tokens'
            : 'stop',
      usage: response.usage ? {
        input_tokens: response.usage.prompt_tokens,
        output_tokens: response.usage.completion_tokens,
      } : undefined,
    }
  }
}
