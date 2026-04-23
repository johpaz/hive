import { logger } from "../../utils/logger"
import { sanitizeMessages, requiresTemperature1, OPENAI_COMPAT_BASE_URLS } from "./interface"
import type { LLMCallOptions, LLMProvider, LLMResponse, LLMToolCall } from "./interface"

const log = logger.child("llm-client")

export class OpenAICompatProvider implements LLMProvider {
  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const { default: OpenAI } = await import("openai")

    const baseURL = options.baseUrl?.trim() || OPENAI_COMPAT_BASE_URLS[options.provider] || undefined
    const isLocal = baseURL?.includes("localhost") || baseURL?.includes("127.0.0.1") || baseURL?.includes("::1")
    const apiKey = options.apiKey || (isLocal ? "ollama" : undefined)

    if (!apiKey) {
      throw new Error(`API key missing for provider: ${options.provider}. Configure it in Settings → Providers.`)
    }

    const client = new OpenAI({ apiKey, baseURL })

    const isKimi = options.provider === "kimi"
    const isDeepSeek = options.provider === "deepseek"
    // Kimi K2 and DeepSeek reasoner require reasoning_content to be round-tripped
    const needsReasoningRoundtrip = isKimi || isDeepSeek

    const sanitized = sanitizeMessages(options.messages)
    const messagesForProvider = needsReasoningRoundtrip
      ? sanitized
      : sanitized.map(({ reasoning_content: _rc, ...rest }) => rest as typeof sanitized[number])

    const providerPrefix = new RegExp(`^${options.provider}\\/`, "i")
    const body: any = {
      model: options.model.replace(providerPrefix, ""),
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

    // Stream when onToken callback is provided (better UX for long responses)
    if (options.onToken) {
      return this._streamCall(client, body, options)
    }

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

  private async _streamCall(client: any, body: any, options: LLMCallOptions): Promise<LLMResponse> {
    const stream = await client.chat.completions.create({ ...body, stream: true })

    let content = ""
    let reasoning_content = ""
    let finish_reason = "stop"
    // Accumulate tool_calls by index
    const toolCallMap: Map<number, { id: string; name: string; arguments: string }> = new Map()
    let input_tokens = 0
    let output_tokens = 0

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0]
      if (!choice) continue

      const delta = choice.delta as any
      if (delta.content) {
        content += delta.content
        options.onToken!(delta.content)
      }
      if (delta.reasoning_content) {
        reasoning_content += delta.reasoning_content
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx: number = tc.index
          if (!toolCallMap.has(idx)) {
            toolCallMap.set(idx, { id: tc.id ?? "", name: tc.function?.name ?? "", arguments: "" })
          }
          const entry = toolCallMap.get(idx)!
          if (tc.id) entry.id = tc.id
          if (tc.function?.name) entry.name = tc.function.name
          if (tc.function?.arguments) entry.arguments += tc.function.arguments
        }
      }
      if (choice.finish_reason) finish_reason = choice.finish_reason

      // Some providers include usage in the final chunk
      if (chunk.usage) {
        input_tokens = chunk.usage.prompt_tokens ?? 0
        output_tokens = chunk.usage.completion_tokens ?? 0
      }
    }

    const tool_calls: LLMToolCall[] = [...toolCallMap.values()].map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments || "{}" },
    }))

    return {
      content,
      tool_calls: tool_calls.length ? tool_calls : undefined,
      reasoning_content: reasoning_content || undefined,
      stop_reason:
        finish_reason === "tool_calls" ? "tool_calls"
          : finish_reason === "length" ? "max_tokens"
            : "stop",
      usage: input_tokens > 0 || output_tokens > 0
        ? { input_tokens, output_tokens }
        : undefined,
    }
  }
}
