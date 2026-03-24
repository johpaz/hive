import { logger } from "../../utils/logger"
import { sanitizeMessages } from "./interface"
import type { LLMCallOptions, LLMProvider, LLMResponse, LLMToolCall } from "./interface"

const log = logger.child("llm-client")

export class OllamaProvider implements LLMProvider {
  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const { Ollama } = await import("ollama")

    const modelName = options.model.replace(/^ollama\//, "")
    const host = options.baseUrl?.trim() || process.env.OLLAMA_HOST || "http://localhost:11434"
    const isCloud = host.includes("ollama.com")
    const headers: Record<string, string> = {}
    if (isCloud && options.apiKey) headers["Authorization"] = `Bearer ${options.apiKey}`

    const client = new Ollama({
      host,
      ...(Object.keys(headers).length ? { headers } : {}),
    })

    const messages = sanitizeMessages(options.messages).map((m): any => {
      if (m.role === "assistant" && m.tool_calls?.length) {
        return {
          role: "assistant",
          content: m.content || "",
          tool_calls: m.tool_calls.map((tc) => ({
            function: {
              name: tc.function.name,
              arguments: (() => {
                try { return JSON.parse(tc.function.arguments) } catch { return {} }
              })(),
            },
          })),
        }
      }
      if (m.role === "tool") return { role: "tool", content: m.content }
      return { role: m.role, content: m.content }
    })

    const tools = options.tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }))

    // Default num_ctx to 4096 for local models — prevents OOM on small models (2B-7B)
    // when Ollama's default (32k+) is too large for available RAM/VRAM.
    // Users can override via providers.num_ctx in DB.
    const runtimeOptions: Record<string, unknown> = {
      num_ctx: options.numCtx ?? 4096,
    }
    if (options.numGpu !== undefined) runtimeOptions.num_gpu = options.numGpu
    if (options.temperature !== undefined) runtimeOptions.temperature = options.temperature

    try {

      log.info(
        `[llm-client] ollama/${modelName} @ ${isCloud ? "ollama.com" : host} stream=true` +
        ` — ${messages.length} msgs, ${tools?.length ?? 0} tools` +
        ` num_ctx=${runtimeOptions.num_ctx}`
      )

      const stream = await client.chat({
        model: modelName,
        messages,
        tools: tools?.length ? tools : undefined,
        options: Object.keys(runtimeOptions).length ? runtimeOptions : undefined,
        stream: true,
      })

      let content = ""
      let promptEvalCount = 0
      let evalCount = 0
      const tool_calls: LLMToolCall[] = []

      for await (const part of stream) {
        const delta = part.message?.content ?? ""
        if (delta) {
          content += delta
          if (options.onToken) options.onToken(delta)
        }

        if (part.message?.tool_calls?.length) {
          for (const tc of part.message.tool_calls) {
            tool_calls.push({
              id: crypto.randomUUID(),
              type: "function" as const,
              function: {
                name: (tc as any).function.name,
                arguments: JSON.stringify((tc as any).function.arguments ?? {}),
              },
            })
          }
        }

        if (part.prompt_eval_count !== undefined) promptEvalCount = part.prompt_eval_count
        if (part.eval_count !== undefined) evalCount = part.eval_count
      }

      return {
        content,
        tool_calls: tool_calls.length ? tool_calls : undefined,
        stop_reason: tool_calls.length > 0 ? "tool_calls" : "stop",
        usage:
          evalCount > 0
            ? { input_tokens: promptEvalCount, output_tokens: evalCount }
            : undefined,
      }
    } catch (error: any) {
      log.error(`[llm-client] FAILED call to ollama/${modelName} at ${host}`)
      log.error(`[llm-client] Error details: ${error.message || error}`)
      if (options.numCtx) log.error(`[llm-client] Context requested: num_ctx=${options.numCtx}`)
      if (options.tools?.length) log.error(`[llm-client] Tools defined: ${options.tools.length}`)

      // If the model runner crashed (likely OOM) and tools were sent, retry without tools.
      // The model can still answer conversationally — tools will be unavailable this turn.
      if (
        error.message?.includes("model runner has unexpectedly stopped") &&
        tools?.length
      ) {
        log.warn(`[llm-client] OOM with tools — retrying without tools (num_ctx=${runtimeOptions.num_ctx})`)
        const stream2 = await client.chat({
          model: modelName,
          messages,
          tools: undefined,
          options: runtimeOptions,
          stream: true,
        })
        let content = ""
        for await (const part of stream2) {
          const delta = part.message?.content ?? ""
          if (delta) { content += delta; if (options.onToken) options.onToken(delta) }
        }
        return { content, tool_calls: undefined, stop_reason: "stop" }
      }

      throw error
    }
  }
}
