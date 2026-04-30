import { logger } from "../../utils/logger"
import { sanitizeMessages } from "./interface"
import type { LLMCallOptions, LLMProvider, LLMResponse, LLMToolCall } from "./interface"
import type { ContentPart, LLMMessage } from "../llm-client"

const log = logger.child("llm-client")

export class GeminiProvider implements LLMProvider {
  private _convertContentPart(part: ContentPart): any {
    switch (part.type) {
      case "text":
        return { text: part.text }
      case "image_url": {
        const url = part.image_url.url
        if (url.startsWith("data:")) {
          const match = url.match(/^data:([^;]+);base64,(.+)$/)
          if (match) return { inlineData: { mimeType: match[1], data: match[2] } }
        }
        return { text: `[Image URL: ${url}]` }
      }
      case "image_base64":
        return { inlineData: { mimeType: part.mimeType, data: part.base64 } }
      case "document":
        return { inlineData: { mimeType: part.mimeType, data: part.base64 } }
      default:
        return { text: JSON.stringify(part) }
    }
  }

  private _convertUserParts(msg: LLMMessage): any[] {
    if (Array.isArray(msg.content)) {
      return msg.content.map(p => this._convertContentPart(p))
    }
    return [{ text: msg.content }]
  }

  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const { GoogleGenAI } = await import("@google/genai")

    const clientOpts: any = { apiKey: options.apiKey }
    if (options.baseUrl?.trim()) clientOpts.httpOptions = { baseUrl: options.baseUrl.trim() }

    const ai = new GoogleGenAI(clientOpts)

    const cleanMessages = sanitizeMessages(options.messages)

    // Build toolCallId → name map for converting tool results
    const toolNameMap = new Map<string, string>()
    for (const msg of cleanMessages) {
      if (msg.role === "assistant" && msg.tool_calls) {
        for (const tc of msg.tool_calls) toolNameMap.set(tc.id, tc.function.name)
      }
    }

    // Convert canonical messages → Gemini Content[]
    let systemText = ""
    const rawContents: any[] = []

    for (const msg of cleanMessages) {
      if (msg.role === "system") {
        systemText += (systemText ? "\n\n" : "") + msg.content
        continue
      }
    if (msg.role === "user") {
      rawContents.push({ role: "user", parts: this._convertUserParts(msg) })
      continue
    }
      if (msg.role === "assistant") {
        const parts: any[] = []
        if (msg.content) parts.push({ text: msg.content })
        for (const tc of msg.tool_calls ?? []) {
          const fcPart: any = { functionCall: { name: tc.function.name, args: JSON.parse(tc.function.arguments || "{}") } }
          if (tc.thought_signature) fcPart.thoughtSignature = tc.thought_signature
          parts.push(fcPart)
        }
        if (parts.length) rawContents.push({ role: "model", parts })
        continue
      }
      if (msg.role === "tool") {
        const fnName = toolNameMap.get(msg.tool_call_id || "") || msg.name || "tool"
        const frPart = { functionResponse: { name: fnName, response: { output: msg.content } } }
        const last = rawContents[rawContents.length - 1]
        if (last?.role === "user" && Array.isArray(last.parts)) {
          last.parts.push(frPart)
        } else {
          rawContents.push({ role: "user", parts: [frPart] })
        }
      }
    }

    // Gemini constraint enforcement
    const contents: any[] = rawContents

    while (contents.length > 0 && contents[0].role === "model") {
      log.warn(`[llm-client] Gemini: removed leading model turn (no preceding user turn)`)
      contents.shift()
    }

    let changed = true
    let safetyLimit = 10
    while (changed && safetyLimit-- > 0) {
      changed = false

      for (let i = 0; i < contents.length; i++) {
        const turn = contents[i]
        const prev = i > 0 ? contents[i - 1] : null

        // INV-3: merge consecutive model turns
        if (turn.role === "model" && prev?.role === "model") {
          prev.parts.push(...(turn.parts ?? []))
          contents.splice(i, 1)
          i--
          changed = true
          continue
        }

        // INV-1: model(fc) must come after user
        if (turn.role === "model") {
          const hasFc = turn.parts?.some((p: any) => p.functionCall)
          if (hasFc && prev?.role !== "user") {
            turn.parts = (turn.parts ?? []).filter((p: any) => !p.functionCall)
            log.warn(`[llm-client] Gemini: stripped functionCall not after user turn (i=${i})`)
            if (turn.parts.length === 0) { contents.splice(i, 1); i-- }
            changed = true
            continue
          }
        }

        // INV-2: user(fr) must come after model(fc)
        if (turn.role === "user") {
          const hasFr = turn.parts?.some((p: any) => p.functionResponse)
          const prevHasFc = prev?.role === "model" && prev?.parts?.some((p: any) => p.functionCall)
          if (hasFr && !prevHasFc) {
            turn.parts = (turn.parts ?? []).filter((p: any) => !p.functionResponse)
            log.warn(`[llm-client] Gemini: stripped orphaned functionResponse (i=${i})`)
            if (turn.parts.length === 0) { contents.splice(i, 1); i-- }
            changed = true
            continue
          }
        }
      }
    }

    if (safetyLimit <= 0) {
      log.error(`[llm-client] Gemini: constraint enforcement loop exhausted — message history may still violate Gemini constraints`)
    }

    const config: any = {}
    if (systemText) config.systemInstruction = systemText
    if (options.maxTokens) config.maxOutputTokens = options.maxTokens
    if (options.temperature !== undefined) config.temperature = options.temperature
    if (options.tools?.length) {
      config.tools = [{
        functionDeclarations: options.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }]
    }

    log.info(`[llm-client] gemini/${options.model} — ${contents.length} turns, ${options.tools?.length ?? 0} tools`)

    const response = await ai.models.generateContent({ model: options.model, contents, config })

    const candidate = response.candidates?.[0]

    // Handle safety blocks explicitly
    if (candidate?.finishReason === "SAFETY") {
      log.warn(`[llm-client] Gemini: response blocked by safety filters (model=${options.model})`)
      return {
        content: "[Response blocked by Gemini safety filters]",
        stop_reason: "stop",
        usage: response.usageMetadata ? {
          input_tokens: response.usageMetadata.promptTokenCount ?? 0,
          output_tokens: 0,
        } : undefined,
      }
    }

    const parts: any[] = candidate?.content?.parts ?? []

    let content = ""
    const tool_calls: LLMToolCall[] = []

    for (const part of parts) {
      if (part.text) content += part.text
      if (part.functionCall) {
        tool_calls.push({
          id: crypto.randomUUID(),
          type: "function",
          function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) },
          thought_signature: part.thoughtSignature ?? undefined,
        })
      }
    }

    const stop_reason: LLMResponse["stop_reason"] =
      tool_calls.length > 0 ? "tool_calls"
        : candidate?.finishReason === "MAX_TOKENS" ? "max_tokens"
          : "stop"

    const usageMeta = response.usageMetadata
    return {
      content,
      tool_calls: tool_calls.length ? tool_calls : undefined,
      stop_reason,
      usage: usageMeta ? {
        input_tokens: usageMeta.promptTokenCount ?? 0,
        output_tokens: usageMeta.candidatesTokenCount ?? 0,
        thinking_tokens: (usageMeta as any).thoughtsTokenCount ?? 0,
      } : undefined,
    }
  }
}
