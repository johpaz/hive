import { logger } from "../../utils/logger"
import {
  sanitizeMessages, requiresTemperature1, OPENAI_COMPAT_BASE_URLS,
  getProviderProfile, modelSupportsTools, normalizeToolName, normalizeToolSchema,
} from "./interface"
import type { LLMCallOptions, LLMProvider, LLMResponse, LLMToolCall } from "./interface"
import type { ContentPart, LLMMessage } from "../llm-client"

const log = logger.child("llm-client")

export class OpenAICompatProvider implements LLMProvider {
  private _convertContentPart(part: ContentPart): any {
    switch (part.type) {
      case "text":
        return { type: "text", text: part.text }
      case "image_url":
        return { type: "image_url", image_url: { url: part.image_url.url } }
      case "image_base64":
        return { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.base64}` } }
      case "document":
        return { type: "text", text: `[Document: ${part.fileName || "file"}] (base64 content not displayed)` }
      default:
        return { type: "text", text: JSON.stringify(part) }
    }
  }

  private _convertMessage(msg: LLMMessage): any {
    if (Array.isArray(msg.content)) {
      return { ...msg, content: msg.content.map(p => this._convertContentPart(p)) }
    }
    return msg
  }

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
    const rawMessages = needsReasoningRoundtrip
      ? sanitized
      : sanitized.map(({ reasoning_content: _rc, ...rest }) => rest as typeof sanitized[number])
    const messagesForProvider = rawMessages.map(m => this._convertMessage(m))

    const providerPrefix = new RegExp(`^${options.provider}\\/`, "i")
    const body: any = {
      model: options.model.replace(providerPrefix, ""),
      messages: messagesForProvider,
      temperature: requiresTemperature1(options.provider, options.model) ? 1 : (options.temperature ?? 0.7),
    }
    if (options.maxTokens) body.max_tokens = options.maxTokens
    if (options.numCtx && isLocal) body.num_ctx = options.numCtx

    // Per-provider profile drives tool call behavior
    const profile = getProviderProfile(options.provider)
    const sendTools = modelSupportsTools(options.provider, options.model) && !!(options.tools?.length)

    // Map from wire name (normalized) → original name for denormalizing responses
    const toolNameMap = new Map<string, string>()

    if (sendTools) {
      const preparedTools = options.tools!.map((t) => {
        const originalName = t.function.name
        const wireName = profile.normalizeToolNames
          ? normalizeToolName(originalName, profile.toolNameReplacement)
          : originalName
        if (wireName !== originalName) toolNameMap.set(wireName, originalName)
        return {
          ...t,
          function: {
            ...t.function,
            name: wireName,
            parameters: normalizeToolSchema(t.function.parameters as Record<string, unknown>, profile),
          },
        }
      })
      body.tools = preparedTools
      body.tool_choice = profile.toolChoiceAuto
      if (profile.disableParallelToolCalls) body.parallel_tool_calls = false
    }

    log.info(`[llm-client] ${options.provider}/${body.model} — ${options.messages.length} msgs, ${options.tools?.length ?? 0} tools${sendTools ? "" : " (tools suppressed)"}`)

    if (options.onToken) {
      return this._streamCall(client, body, options, toolNameMap, sendTools, profile)
    }

    let response
    try {
      response = await client.chat.completions.create(body)
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status
      if (sendTools && profile.retryWithoutToolsOnCodes.includes(status)) {
        log.warn(`[llm-client] ${options.provider}: tools rejected (HTTP ${status}) — retrying without tools`)
        const bodyNoTools = { ...body }
        delete bodyNoTools.tools
        delete bodyNoTools.tool_choice
        delete bodyNoTools.parallel_tool_calls
        response = await client.chat.completions.create(bodyNoTools)
      } else {
        throw err
      }
    }

    const choice = response.choices[0]
    const msg = choice.message

    const tool_calls: LLMToolCall[] | undefined = (msg.tool_calls as any[])?.map((tc: any) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: toolNameMap.get(tc.function.name) ?? tc.function.name,
        arguments: tc.function.arguments,
      },
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

  private async _streamCall(
    client: any,
    body: any,
    options: LLMCallOptions,
    toolNameMap: Map<string, string>,
    sendTools: boolean,
    profile: ReturnType<typeof getProviderProfile>,
  ): Promise<LLMResponse> {
    let stream
    try {
      stream = await client.chat.completions.create({ ...body, stream: true })
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status
      if (sendTools && profile.retryWithoutToolsOnCodes.includes(status)) {
        log.warn(`[llm-client] ${options.provider}: tools rejected (HTTP ${status}) — retrying stream without tools`)
        const bodyNoTools = { ...body }
        delete bodyNoTools.tools
        delete bodyNoTools.tool_choice
        delete bodyNoTools.parallel_tool_calls
        stream = await client.chat.completions.create({ ...bodyNoTools, stream: true })
      } else {
        throw err
      }
    }

    let content = ""
    let reasoning_content = ""
    let finish_reason = "stop"
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

      if (chunk.usage) {
        input_tokens = chunk.usage.prompt_tokens ?? 0
        output_tokens = chunk.usage.completion_tokens ?? 0
      }
    }

    const tool_calls: LLMToolCall[] = [...toolCallMap.values()].map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: toolNameMap.get(tc.name) ?? tc.name,
        arguments: tc.arguments || "{}",
      },
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
