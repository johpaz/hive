import { logger } from "../../utils/logger"
import {
  sanitizeMessages, requiresTemperature1, OPENAI_COMPAT_BASE_URLS,
  getProviderProfile, modelSupportsTools, normalizeToolName, normalizeToolSchema,
} from "./interface"
import type { LLMCallOptions, LLMProvider, LLMResponse, LLMToolCall } from "./interface"
import type { ContentPart, LLMMessage } from "../llm-client"

const log = logger.child("llm-client")

export abstract class OpenAICompatBase implements LLMProvider {
  constructor(protected readonly providerName: string) {}

  /** Override to true when the provider requires reasoning_content to be round-tripped. */
  protected needsReasoningRoundtrip(): boolean { return false }

  /** Override to true for providers running on localhost. */
  protected isLocalProvider(): boolean { return false }

  /** Override to customize the OpenAI client (e.g. strip unwanted headers, add custom fetch). */
  protected async resolveOpenAIClient(apiKey: string, baseURL: string | undefined): Promise<any> {
    const { default: OpenAI } = await import("openai")
    return new OpenAI({ apiKey, baseURL })
  }

  /** Hook called before each request. Override for e.g. auto-starting a local server. */
  protected async beforeCall(_options: LLMCallOptions): Promise<void> {}

  /**
   * Hook called after tools are prepared when sendTools is true.
   * Override to inject tool descriptions into the system prompt
   * (for local models whose chat templates don't support native tool calling).
   */
  protected injectToolsIntoPrompt(_body: any, _preparedTools: any[]): void {}

  /** Override to add provider-specific fields to the request body (e.g. extra_body for llama.cpp chat_template_kwargs). */
  protected modifyRequestBody(body: any, _options: LLMCallOptions): any { return body }

  private _convertContentPart(part: ContentPart): any {
    switch (part.type) {
      case "text":
        return { type: "text", text: part.text }
      case "image_url":
        return { type: "image_url", image_url: { url: part.image_url.url } }
      case "image_base64":
        return { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.base64}` } }
      case "document":
        log.warn(`[llm-client] ${this.providerName}: document content parts are not supported — content will be omitted`)
        return { type: "text", text: `[Document: ${(part as any).fileName || "file"}] (content not supported for this provider)` }
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
    const baseURL = options.baseUrl?.trim() || OPENAI_COMPAT_BASE_URLS[this.providerName] || undefined
    const isLocal = this.isLocalProvider()

    await this.beforeCall(options)

    const apiKey = options.apiKey || (isLocal ? "ollama" : undefined)
    if (!apiKey) {
      throw new Error(`API key missing for provider: ${this.providerName}. Configure it in Settings → Providers.`)
    }

    const client = await this.resolveOpenAIClient(apiKey, baseURL)

    const sanitized = sanitizeMessages(options.messages)
    const rawMessages = this.needsReasoningRoundtrip()
      ? sanitized
      : sanitized.map(({ reasoning_content: _rc, ...rest }) => rest as typeof sanitized[number])
    const messagesForProvider = rawMessages.map(m => this._convertMessage(m))

    const providerPrefix = new RegExp(`^${this.providerName}\\/`, "i")
    const body: any = {
      model: options.model.replace(providerPrefix, ""),
      messages: messagesForProvider,
      temperature: requiresTemperature1(this.providerName, options.model) ? 1 : (options.temperature ?? 0.7),
    }
    if (options.maxTokens) {
      body.max_tokens = options.maxTokens
    } else if (options.contextWindow) {
      // Reserve 15% of context window for output tokens, cap at 8192
      body.max_tokens = Math.min(8192, Math.floor(options.contextWindow * 0.15))
    }
    if (options.numCtx && isLocal) body.num_ctx = options.numCtx

    const profile = getProviderProfile(this.providerName)
    const sendTools = modelSupportsTools(this.providerName, options.model) && !!(options.tools?.length)

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

      this.injectToolsIntoPrompt(body, preparedTools)
    }

    log.info(`[llm-client] ${this.providerName}/${body.model} — ${options.messages.length} msgs, ${options.tools?.length ?? 0} tools${sendTools ? "" : " (tools suppressed)"}`)

    if (options.onToken) {
      return this._streamCall(client, body, options, toolNameMap, sendTools, profile)
    }

    let response
    try {
      response = await client.chat.completions.create(this.modifyRequestBody(body, options))
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status
      const errMsg = (err?.error?.message ?? err?.message ?? "").toLowerCase()

      // Retry 1: tools rejected by provider — remove tools and retry
      if (sendTools && profile.retryWithoutToolsOnCodes.includes(status)) {
        log.warn(`[llm-client] ${this.providerName}: tools rejected (HTTP ${status}) — retrying without tools`)
        const bodyNoTools = { ...body }
        delete bodyNoTools.tools
        delete bodyNoTools.tool_choice
        delete bodyNoTools.parallel_tool_calls
        response = await client.chat.completions.create(this.modifyRequestBody(bodyNoTools, options))
      }
      // Retry 2: context overflow — compact messages and retry
      else if (status === 400 && (errMsg.includes("context length") || errMsg.includes("input_tokens") || errMsg.includes("maximum input length"))) {
        log.warn(`[llm-client] ${this.providerName}: context overflow — compacting messages and retrying`)
        const compacted = [...body.messages]
        const kept: any[] = []
        let systemMsg: any = null
        for (const m of compacted) {
          if (m.role === "system") { systemMsg = m; continue }
          kept.push(m)
        }
        // Keep only 33% of messages to free enough context budget
        const keepRatio = Math.max(1, Math.floor(kept.length / 3))
        const trimmed = kept.slice(-keepRatio)
        body.messages = systemMsg ? [systemMsg, ...trimmed] : trimmed
        // Reduce output budget to leave more room for input
        if (body.max_tokens) body.max_tokens = Math.min(body.max_tokens, 4096)

        log.info(`[llm-client] ${this.providerName}: compacted ${compacted.length} msgs → ${body.messages.length} msgs, max_tokens=${body.max_tokens}`)
        response = await client.chat.completions.create(this.modifyRequestBody(body, options))
      }
      else {
        throw err
      }
    }

    const choice = response.choices[0]
    const msg = choice.message

    let final_tool_calls: LLMToolCall[] | undefined = (msg.tool_calls as any[])?.map((tc: any) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: toolNameMap.get(tc.function.name) ?? tc.function.name,
        arguments: tc.function.arguments,
      },
    }))

    let final_content = msg.content ?? ""

    if (sendTools && (!final_tool_calls || final_tool_calls.length === 0) && final_content) {
      const extracted = extractToolCallsFromText(final_content, toolNameMap)
      if (extracted.tool_calls.length > 0) {
        final_tool_calls = extracted.tool_calls
        final_content = extracted.content
      }
    }

    return {
      content: final_content,
      tool_calls: final_tool_calls,
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
      stream = await client.chat.completions.create({ ...this.modifyRequestBody(body, options), stream: true })
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status
      const errMsg = (err?.error?.message ?? err?.message ?? "").toLowerCase()

      if (sendTools && profile.retryWithoutToolsOnCodes.includes(status)) {
        log.warn(`[llm-client] ${this.providerName}: tools rejected (HTTP ${status}) — retrying stream without tools`)
        const bodyNoTools = { ...body }
        delete bodyNoTools.tools
        delete bodyNoTools.tool_choice
        delete bodyNoTools.parallel_tool_calls
        stream = await client.chat.completions.create({ ...this.modifyRequestBody(bodyNoTools, options), stream: true })
      } else if (status === 400 && (errMsg.includes("context length") || errMsg.includes("input_tokens") || errMsg.includes("maximum input length"))) {
        log.warn(`[llm-client] ${this.providerName}: context overflow — compacting messages and retrying stream`)
        const compacted = [...body.messages]
        const kept: any[] = []
        let systemMsg: any = null
        for (const m of compacted) {
          if (m.role === "system") { systemMsg = m; continue }
          kept.push(m)
        }
        const keepRatio = Math.max(1, Math.floor(kept.length / 3))
        const trimmed = kept.slice(-keepRatio)
        body.messages = systemMsg ? [systemMsg, ...trimmed] : trimmed
        if (body.max_tokens) body.max_tokens = Math.min(body.max_tokens, 4096)
        log.info(`[llm-client] ${this.providerName}: compacted ${compacted.length} msgs → ${body.messages.length} msgs, max_tokens=${body.max_tokens}`)
        stream = await client.chat.completions.create({ ...this.modifyRequestBody(body, options), stream: true })
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
        options.onReasoningToken?.(delta.reasoning_content)
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

    let final_tool_calls: LLMToolCall[] | undefined = tool_calls.length ? tool_calls : undefined
    let final_content = content

    if (sendTools && !final_tool_calls && final_content) {
      const extracted = extractToolCallsFromText(final_content, toolNameMap)
      if (extracted.tool_calls.length > 0) {
        final_tool_calls = extracted.tool_calls
        final_content = extracted.content
      }
    }

    return {
      content: final_content,
      tool_calls: final_tool_calls,
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

/**
 * Extracts tool_calls from text when the model fails to emit native tool_calls.
 * Supports common formats used by Gemma, Qwen, and other local models.
 */
export function extractToolCallsFromText(
  content: string,
  toolNameMap: Map<string, string>,
  knownToolNames?: Set<string>,
): { content: string; tool_calls: LLMToolCall[] } {
  const tool_calls: LLMToolCall[] = []
  let extractedContent = content

  // Regexes for wrapped tool-call blocks.
  const regexes = [
    /<tool_call>\s*({[\s\S]*?})\s*<\/tool_call>/g,
    /<function_call>\s*({[\s\S]*?})\s*<\/function_call>/g,
    /```(?:tool_call|json)\s*({[\s\S]*?})\s*```/g,
  ]

  for (const regex of regexes) {
    let match
    while ((match = regex.exec(content)) !== null) {
      try {
        const json = JSON.parse(match[1])
        const calls = Array.isArray(json) ? json : [json]
        for (const call of calls) {
          if (!call) continue
          // Accept both { name, arguments } and { function: { name, arguments } }
          const fn = call.function || call
          const name = fn.name ?? call.name
          let args = fn.arguments ?? call.arguments ?? call.parameters
          if (!name) continue
          tool_calls.push({
            id: crypto.randomUUID(),
            type: "function",
            function: {
              name: toolNameMap.get(name) ?? name,
              arguments: typeof args === "object" ? JSON.stringify(args) : (args || "{}"),
            },
          })
          extractedContent = extractedContent.replace(match[0], "").trim()
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  // Fallback: entire output is a bare JSON tool call — only if name matches a known tool
  if (tool_calls.length === 0 && knownToolNames && knownToolNames.size > 0) {
    try {
      const trimmed = content.trim()
      // Strip common markdown fences before parsing.
      const jsonText = trimmed.replace(/^```(?:json|tool_call)?\s*|\s*```$/g, "").trim()
      const json = JSON.parse(jsonText)
      const calls = Array.isArray(json) ? json : [json]
      for (const call of calls) {
        if (!call) continue
        const fn = call.function || call
        const name = fn.name ?? call.name
        let args = fn.arguments ?? call.arguments ?? call.parameters
        const resolvedName = toolNameMap.get(name) ?? name
        if (name && knownToolNames.has(resolvedName) && (args !== undefined || calls.length === 1)) {
          tool_calls.push({
            id: crypto.randomUUID(),
            type: "function",
            function: {
              name: resolvedName,
              arguments: typeof args === "object" ? JSON.stringify(args) : (args || "{}"),
            },
          })
          extractedContent = ""
        }
      }
    } catch {
      // not valid JSON
    }
  }

  return { content: extractedContent, tool_calls }
}
