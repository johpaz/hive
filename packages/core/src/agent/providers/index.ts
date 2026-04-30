/**
 * AgentRunner — thin wrapper over the native AgentLoop.
 *
 * Keeps the same public API (generate()) so server.ts doesn't need changes.
 * Internally uses agent-loop.ts instead of LangGraph.
 */

import type { Config } from "../../config/loader.ts"
import { logger } from "../../utils/logger.ts"
import { getDb } from "../../storage/sqlite.ts"
import { getAgentLoop } from "../agent-loop"
import { resolveUserId, resolveAgentId } from "../../storage/onboarding"
import type { ContentPart } from "../../multimodal/types"

export type Provider = "openai" | "anthropic" | "gemini" | "mistral" | "kimi" | "ollama" | "openrouter" | "deepseek" | "nvidia"

export interface StepEvent {
  type: "text" | "plan" | "tool_call" | "tool_result"
  message: string
  toolName?: string
  isError?: boolean
}

export interface ModelOptions {
  provider?: Provider
  model?: string
  maxTokens?: number
  temperature?: number
  system?: string
  messages: Array<{ role: string; content: string | ContentPart[] }>
  tools?: Record<string, any>
  maxSteps?: number
  onToken?: (token: string) => void
  onStep?: (step: StepEvent) => Promise<void>
  threadId?: string
  userId?: string
  channel?: string
  rawUserMessage?: string
  signal?: AbortSignal
}

export interface ModelResponse {
  content: string
  toolCalls?: Array<{
    id: string
    name: string
    args: Record<string, unknown>
  }>
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  finishReason?: string
}

export class AgentRunner {
  private config: Config

  constructor(config: Config) {
    this.config = config
  }

  async generate(options: ModelOptions): Promise<ModelResponse> {
    const db = getDb()
    // Resolve agentId from database (coordinator or first enabled)
    const agentId = resolveAgentId(null) || "main"

    // Resolve userId from database
    const userId = options.userId || resolveUserId({})
    if (!userId) {
      throw new Error("No userId provided. Please complete onboarding first.")
    }
    const threadId = options.threadId || userId

    const agentLoop = getAgentLoop()
    if (!agentLoop) {
      throw new Error("AgentLoop not initialized")
    }

    let lastAgentContent = ""
    let accumulatedAgentContent = ""  // Accumulate content from all agent chunks
    let toolCalls: ModelResponse["toolCalls"] = []
    let totalInputTokens = 0
    let totalOutputTokens = 0

    try {
      const stream = agentLoop.stream(
        { messages: options.messages },
        {
          configurable: {
            thread_id: threadId,
            agent_id: agentId,
            user_id: userId,
            // system_prompt intentionally omitted — context-compiler builds it
            channel: options.channel,
            raw_user_message: options.rawUserMessage,
          },
          signal: options.signal,
        }
      )

      let chunkCount = 0
      for await (const chunk of stream) {
        chunkCount++

        if (chunk.agent?.messages) {
          const lastMsg = chunk.agent.messages[chunk.agent.messages.length - 1]
          const hasToolCalls = (lastMsg as any)?.tool_calls?.length > 0
          const contentLen = lastMsg?.content?.length ?? 0
          const contentType = typeof lastMsg?.content
          logger.info(
            `[STREAM] chunk#${chunkCount} agent: contentLen=${contentLen} hasToolCalls=${hasToolCalls} contentType=${contentType}`
          )

          if (lastMsg?.content) {
            const content = typeof lastMsg.content === "string" 
              ? lastMsg.content 
              : Array.isArray(lastMsg.content)
                ? lastMsg.content.filter(p => p.type === "text").map(p => (p as any).text).join("\n")
                : ""
            lastAgentContent = content
            // Accumulate non-empty content that's not just whitespace
            if (content && content.trim().length > 0) {
              accumulatedAgentContent += (accumulatedAgentContent ? "\n" : "") + content
              logger.debug(`[STREAM] Accumulated content: total length=${accumulatedAgentContent.length}`)
            } else {
              logger.debug(`[STREAM] Content empty or whitespace only, skipping accumulation`)
            }
            if (options.onToken) options.onToken(content)
          } else {
            logger.debug(`[STREAM] No content in chunk, lastMsg.content is falsy`)
          }

          if (hasToolCalls) {
            toolCalls = (lastMsg as any).tool_calls.map((tc: any) => ({
              id: tc.id || tc.function?.name,
              name: tc.function?.name || tc.name,
              args: tc.function?.arguments
                ? (typeof tc.function.arguments === "string"
                    ? JSON.parse(tc.function.arguments)
                    : tc.function.arguments)
                : {},
            }))

            const narration = lastMsg?.content || ""
            if (options.onStep && narration) {
              await options.onStep({ type: "text", message: narration })
            }
            if (options.onStep) {
              for (const tc of toolCalls) {
                await options.onStep({
                  type: "tool_call",
                  toolName: tc.name,
                  message: `Calling tool: \`${tc.name}\``,
                })
              }
            }
          }
        }

        if (chunk.tools?.messages) {
          const lastMsg = chunk.tools.messages[chunk.tools.messages.length - 1]
          if (lastMsg?.content && options.onStep) {
            await options.onStep({
              type: "tool_result",
              message: typeof lastMsg.content === "string" ? lastMsg.content : "",
            })
          }
        }

        if (chunk.usage) {
          totalInputTokens += chunk.usage.input_tokens
          totalOutputTokens += chunk.usage.output_tokens
        }
      }

      logger.debug(`[STREAM] done. totalChunks=${chunkCount} lastAgentContent length=${lastAgentContent.length}, accumulated length=${accumulatedAgentContent.length}`)

      // Use accumulated content if lastAgentContent is empty (handles case where final chunk has no text)
      const finalContent = lastAgentContent || accumulatedAgentContent
      
      logger.info(`[STREAM] Returning response: finalContent length=${finalContent.length}, lastAgentContent length=${lastAgentContent.length}, accumulated length=${accumulatedAgentContent.length}`)

      return {
        content: finalContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          promptTokens: totalInputTokens,
          completionTokens: totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens,
        },
        finishReason: "stop",
      }
    } catch (error) {
      logger.error("AgentRunner error:", error)
      throw error
    }
  }
}

export function createAgentRunner(config: Config): AgentRunner {
  return new AgentRunner(config)
}
