import { logger } from '../../utils/logger'
import type { LLMCallOptions, LLMProvider, LLMResponse, LLMToolCall } from '../interface'

const log = logger.child('llm-client')

export class AnthropicProvider implements LLMProvider {
  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const Anthropic = await import('@anthropic-ai/sdk')
    const client = new Anthropic.default({ apiKey: options.apiKey })

    const systemText = options.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')

    const anthropicMessages: any[] = []
    for (const msg of options.messages) {
      if (msg.role === 'system') continue
      if (msg.role === 'tool') {
        const block = { type: 'tool_result', tool_use_id: msg.tool_call_id, content: msg.content }
        const last = anthropicMessages[anthropicMessages.length - 1]
        if (last?.role === 'user' && Array.isArray(last.content)) {
          last.content.push(block)
        } else {
          anthropicMessages.push({ role: 'user', content: [block] })
        }
        continue
      }
      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        const content: any[] = []
        if (msg.content) content.push({ type: 'text', text: msg.content })
        for (const tc of msg.tool_calls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || '{}') })
        }
        anthropicMessages.push({ role: 'assistant', content })
        continue
      }
      anthropicMessages.push({ role: msg.role, content: msg.content })
    }

    const tools: any[] = (options.tools ?? []).map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }))

    const body: any = { model: options.model, max_tokens: options.maxTokens ?? 8192, messages: anthropicMessages }
    if (systemText) body.system = systemText
    if (tools.length) body.tools = tools

    log.info(`[llm-client] anthropic/${options.model} — ${anthropicMessages.length} msgs, ${tools.length} tools`)

    const response = await client.messages.create(body)

    let content = ''
    const tool_calls: LLMToolCall[] = []
    for (const block of response.content) {
      if (block.type === 'text') content = block.text
      if (block.type === 'tool_use') {
        tool_calls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input) } })
      }
    }

    return {
      content,
      tool_calls: tool_calls.length ? tool_calls : undefined,
      stop_reason:
        response.stop_reason === 'tool_use' ? 'tool_calls'
          : response.stop_reason === 'max_tokens' ? 'max_tokens'
            : 'stop',
      usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    }
  }
}
