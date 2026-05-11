import { logger } from "../../utils/logger"
import { OpenAICompatBase } from "./openai-compat-base"
import type { LLMCallOptions } from "./interface"

const log = logger.child("llm-client")

export class LocalLlamaProvider extends OpenAICompatBase {
  constructor() { super("local-llama") }

  protected isLocalProvider(): boolean { return true }

  /** Auto-start the local llama server if not already running. */
  protected async beforeCall(options: LLMCallOptions): Promise<void> {
    try {
      const { llamaManager } = await import("../../gateway/llm-local/manager")
      const modelId = options.model.replace(/^local-llama\//i, "")
      await llamaManager.start("TEXT", modelId as any)
    } catch (err) {
      log.warn(`[llm-client] local-llama auto-start failed or skipped: ${err}`)
    }
  }

  /**
   * Many GGUF chat templates don't support native tool calling via body.tools,
   * so we inject tool descriptions into the system prompt as a fallback.
   */
  protected injectToolsIntoPrompt(body: any, preparedTools: any[]): void {
    const toolDescriptions = preparedTools.map(t => JSON.stringify(t.function)).join("\n")
    const instruction = `You have access to the following tools. To call a tool, output a JSON block like: <tool_call>{"name": "tool_name", "arguments": {"arg1": "value"}}</tool_call>\n\nTools:\n${toolDescriptions}`
    const sysMsg = body.messages.find((m: any) => m.role === "system")
    if (sysMsg) {
      sysMsg.content += "\n\n" + instruction
    } else {
      body.messages.unshift({ role: "system", content: instruction })
    }
  }
}
