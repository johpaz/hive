import { logger } from "../../utils/logger"
import type { LLMCallOptions, LLMProvider, LLMResponse, LLMToolCall } from "./interface"
import type { ContentPart, LLMMessage } from "../llm-client"

const log = logger.child("llm-client")

// Models that support extended thinking (claude-3-7+ and claude-4.x).
const THINKING_CAPABLE_MODELS = new Set([
  "claude-3-7-sonnet-20250219",
  "claude-sonnet-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-5",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
])

function supportsThinking(model: string): boolean {
  if (THINKING_CAPABLE_MODELS.has(model)) return true
  // Also match any claude-4.x or claude-3-7+ by prefix
  return /^claude-(4|3-7)/.test(model)
}

export class AnthropicProvider implements LLMProvider {
  private _convertContentPart(part: ContentPart): any {
    switch (part.type) {
      case "text":
        return { type: "text", text: part.text }
      case "image_url": {
        const url = part.image_url.url
        if (url.startsWith("data:")) {
          const match = url.match(/^data:([^;]+);base64,(.+)$/)
          if (match) return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } }
        }
        return { type: "image", source: { type: "url", url } }
      }
      case "image_base64":
        return { type: "image", source: { type: "base64", media_type: part.mimeType, data: part.base64 } }
      case "document":
        return { type: "document", source: { type: "base64", media_type: part.mimeType, data: part.base64 } }
      default:
        return { type: "text", text: JSON.stringify(part) }
    }
  }

  private _convertUserContent(msg: LLMMessage): any[] {
    if (Array.isArray(msg.content)) {
      return msg.content.map(p => this._convertContentPart(p))
    }
    return [{ type: "text", text: msg.content }]
  }

  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const Anthropic = await import("@anthropic-ai/sdk")
    const client = new Anthropic.default({ apiKey: options.apiKey })

    const systemText = options.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n")

    const anthropicMessages: any[] = []

    for (const msg of options.messages) {
      if (msg.role === "system") continue

      if (msg.role === "tool") {
        const block = { type: "tool_result", tool_use_id: msg.tool_call_id, content: msg.content }
        const last = anthropicMessages[anthropicMessages.length - 1]
        if (last?.role === "user" && Array.isArray(last.content)) {
          last.content.push(block)
        } else {
          anthropicMessages.push({ role: "user", content: [block] })
        }
        continue
      }

      if (msg.role === "assistant" && msg.tool_calls?.length) {
        const content: any[] = []
        if (msg.content) content.push({ type: "text", text: msg.content })
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown>
          try { input = JSON.parse(tc.function.arguments || "{}") } catch { input = {} }
          content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input })
        }
        anthropicMessages.push({ role: "assistant", content })
        continue
      }

      anthropicMessages.push({ role: msg.role, content: Array.isArray(msg.content) ? this._convertUserContent(msg) : msg.content })
    }

    const tools: any[] = (options.tools ?? []).map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }))

    const body: any = {
      model: options.model,
      max_tokens: options.maxTokens ?? 16384,
      messages: anthropicMessages,
    }
    if (systemText) body.system = systemText
    if (tools.length) body.tools = tools

    // Extended thinking — only for supported models
    const thinkingEnabled = options.thinking?.enabled && supportsThinking(options.model)
    if (thinkingEnabled) {
      body.thinking = { type: "enabled", budget_tokens: options.thinking?.budget_tokens ?? 10000 }
    }

    log.info(
      `[llm-client] anthropic/${options.model} — ${anthropicMessages.length} msgs, ${tools.length} tools` +
      (thinkingEnabled ? ` thinking=${body.thinking.budget_tokens}tok` : "")
    )

    let content = ""
    let thinking_content = ""
    const tool_calls: LLMToolCall[] = []

    // Streaming via messages.stream()
    const useStream = true  // Always stream for better UX
    if (useStream) {
      const stream = client.messages.stream({ ...body, ...(options.signal ? {} : {}) })

      // Track partial tool inputs by index
      const partialInputs: Record<number, string> = {}
      const toolMeta: Record<number, { id: string; name: string }> = {}

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "tool_use") {
            toolMeta[event.index] = { id: event.content_block.id, name: event.content_block.name }
            partialInputs[event.index] = ""
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            content += event.delta.text
            if (options.onToken) options.onToken(event.delta.text)
          } else if (event.delta.type === "thinking_delta") {
            thinking_content += event.delta.thinking
          } else if (event.delta.type === "input_json_delta") {
            if (partialInputs[event.index] !== undefined) {
              partialInputs[event.index] += event.delta.partial_json
            }
          }
        }
      }

      const finalMsg = await stream.finalMessage()

      // Build tool_calls from accumulated partial inputs
      for (const [idx, meta] of Object.entries(toolMeta)) {
        const args = partialInputs[Number(idx)] ?? "{}"
        tool_calls.push({
          id: meta.id,
          type: "function",
          function: { name: meta.name, arguments: args },
        })
      }

      const usage = finalMsg.usage
      return {
        content,
        thinking_content: thinking_content || undefined,
        tool_calls: tool_calls.length ? tool_calls : undefined,
        stop_reason:
          finalMsg.stop_reason === "tool_use" ? "tool_calls"
            : finalMsg.stop_reason === "max_tokens" ? "max_tokens"
              : "stop",
        usage: {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          thinking_tokens: (usage as any).thinking_tokens ?? 0,
        },
      }
    }

    // Non-streaming fallback (kept for reference, unreachable with useStream=true)
    const response = await client.messages.create(body)

    for (const block of response.content) {
      if (block.type === "text") content = block.text
      if (block.type === "thinking") thinking_content = (block as any).thinking ?? ""
      if (block.type === "tool_use") {
        let args: string
        try { args = JSON.stringify(block.input) } catch { args = "{}" }
        tool_calls.push({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: args },
        })
      }
    }

    return {
      content,
      thinking_content: thinking_content || undefined,
      tool_calls: tool_calls.length ? tool_calls : undefined,
      stop_reason:
        response.stop_reason === "tool_use" ? "tool_calls"
          : response.stop_reason === "max_tokens" ? "max_tokens"
            : "stop",
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    }
  }
}
