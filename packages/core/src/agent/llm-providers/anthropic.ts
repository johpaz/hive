import { logger } from "../../utils/logger"
import { normalizeToolName, resolveMaxTokens, ensureArrayItems } from "./interface"
import type { LLMCallOptions, LLMProvider, LLMResponse, LLMToolCall, ThinkingBlock } from "./interface"
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

/** Anthropic's documented shape for context-length errors: 400 + invalid_request_error + a "too long"/"maximum" message. */
function isAnthropicContextOverflowError(err: any): boolean {
  const status = err?.status
  if (status !== 400) return false
  const type = err?.error?.type ?? err?.type
  const msg = (err?.error?.message ?? err?.message ?? "").toLowerCase()
  if (type && type !== "invalid_request_error") return false
  return msg.includes("too long") || msg.includes("maximum context") || msg.includes("prompt is too long") || msg.includes("context length")
}

/** Keeps the first `thinking`/`tool_use` round-trip block intact per message, keeps only the last ~33% of the conversation, and shrinks max_tokens. */
function compactAnthropicBody(body: any): void {
  const keepRatio = Math.max(1, Math.floor(body.messages.length / 3))
  body.messages = body.messages.slice(-keepRatio)
  if (body.max_tokens) body.max_tokens = Math.min(body.max_tokens, 4096)
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

    // Anthropic requires tool names to match ^[a-zA-Z0-9_-]{1,128}$
    // Native Hive tools use dots (e.g. cron.create) which violate this.
    const toolNameMap = new Map<string, string>() // wireName -> originalName

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
        // Extended thinking blocks must be replayed verbatim (with signature) before
        // any tool_use block, or the API rejects the request with a 400.
        if (msg.thinking_blocks?.length) {
          for (const tb of msg.thinking_blocks) {
            content.push(
              tb.type === "thinking"
                ? { type: "thinking", thinking: tb.thinking, signature: tb.signature }
                : { type: "redacted_thinking", data: tb.data }
            )
          }
        }
        if (msg.content) content.push({ type: "text", text: msg.content })
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown>
          try { input = JSON.parse(tc.function.arguments || "{}") } catch { input = {} }
          const wireName = normalizeToolName(tc.function.name, "_")
          if (wireName !== tc.function.name) toolNameMap.set(wireName, tc.function.name)
          content.push({ type: "tool_use", id: tc.id, name: wireName, input })
        }
        anthropicMessages.push({ role: "assistant", content })
        continue
      }

      anthropicMessages.push({ role: msg.role, content: Array.isArray(msg.content) ? this._convertUserContent(msg) : msg.content })
    }

    const tools: any[] = (options.tools ?? []).map((t) => {
      const originalName = t.function.name
      const wireName = normalizeToolName(originalName, "_")
      if (wireName !== originalName) toolNameMap.set(wireName, originalName)
      return {
        name: wireName,
        description: t.function.description,
        input_schema: ensureArrayItems(t.function.parameters),
      }
    })

    const body: any = {
      model: options.model,
      max_tokens: resolveMaxTokens(options.maxTokens, options.contextWindow) ?? 16384,
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

    // Streaming via messages.stream()
    const useStream = true  // Always stream for better UX
    if (useStream) {
      for (let attempt = 0; attempt < 2; attempt++) {
        let content = ""
        let thinking_content = ""
        const tool_calls: LLMToolCall[] = []

        try {
          const stream = client.messages.stream(body, options.signal ? { signal: options.signal } : undefined)

          // Track partial tool inputs by index
          const partialInputs: Record<number, string> = {}
          const toolMeta: Record<number, { id: string; name: string }> = {}
          // Track thinking/redacted_thinking blocks by index — needed both for live
          // display (onReasoningToken) and to round-trip the signed block verbatim
          // in the next turn if this response also contains tool calls.
          const thinkingBlockState: Record<number, { type: "thinking" | "redacted_thinking"; thinking: string; signature: string; data: string }> = {}

          for await (const event of stream) {
            if (event.type === "content_block_start") {
              if (event.content_block.type === "tool_use") {
                const wireName = event.content_block.name
                const originalName = toolNameMap.get(wireName) ?? wireName
                toolMeta[event.index] = { id: event.content_block.id, name: originalName }
                partialInputs[event.index] = ""
              } else if (event.content_block.type === "thinking") {
                thinkingBlockState[event.index] = { type: "thinking", thinking: "", signature: "", data: "" }
              } else if ((event.content_block as any).type === "redacted_thinking") {
                thinkingBlockState[event.index] = { type: "redacted_thinking", thinking: "", signature: "", data: (event.content_block as any).data ?? "" }
              }
            } else if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                content += event.delta.text
                if (options.onToken) options.onToken(event.delta.text)
              } else if (event.delta.type === "thinking_delta") {
                thinking_content += event.delta.thinking
                options.onReasoningToken?.(event.delta.thinking)
                if (thinkingBlockState[event.index]) thinkingBlockState[event.index].thinking += event.delta.thinking
              } else if ((event.delta as any).type === "signature_delta") {
                if (thinkingBlockState[event.index]) thinkingBlockState[event.index].signature += (event.delta as any).signature
              } else if (event.delta.type === "input_json_delta") {
                if (partialInputs[event.index] !== undefined) {
                  partialInputs[event.index] += event.delta.partial_json
                }
              }
            }
          }

          const thinking_blocks: ThinkingBlock[] = Object.keys(thinkingBlockState)
            .map(Number)
            .sort((a, b) => a - b)
            .map((idx) => {
              const b = thinkingBlockState[idx]
              return b.type === "thinking"
                ? { type: "thinking" as const, thinking: b.thinking, signature: b.signature }
                : { type: "redacted_thinking" as const, data: b.data }
            })

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
            thinking_blocks: thinking_blocks.length ? thinking_blocks : undefined,
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
        } catch (err: any) {
          if (attempt === 0 && isAnthropicContextOverflowError(err)) {
            log.warn(`[llm-client] anthropic: context overflow — compacting messages and retrying`)
            const originalCount = body.messages.length
            compactAnthropicBody(body)
            log.info(`[llm-client] anthropic: compacted ${originalCount} msgs → ${body.messages.length} msgs, max_tokens=${body.max_tokens}`)
            continue
          }
          throw err
        }
      }
    }

    throw new Error("unreachable")
  }
}
