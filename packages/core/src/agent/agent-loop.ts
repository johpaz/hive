/**
 * Agent Loop — native implementation, no LangGraph.
 *
 * Replaces supervisor.ts + graph.ts.
 *
 * Pattern:
 *   user message → context compiler → model call → [tool call → model call]* → response
 *
 * Exposes an async generator compatible with the existing providers/index.ts stream API:
 *   yield { agent: { messages: [AIMessage] } }
 *   yield { tools: { messages: [ToolMessage] } }
 *
 * Also used directly by runAgentIsolated() for worker tasks.
 */

import { logger } from "../utils/logger"
import { getDb } from "../storage/sqlite"
import { callLLM, resolveProviderConfig, type LLMMessage } from "./llm-client"
import { addMessage } from "./conversation-store"
import { saveTrace, recordLLMUsage } from "./tracer"
import { maybeCompact, clearOldToolResults } from "./compaction"
import { emitCanvas } from "../canvas/emitter"
import type { MCPClientManager } from "@johpaz/hive-agents-mcp"
import { compileContext } from "./context-compiler"
import { formatToolResult } from "../utils/toon"
import { getAverageTokenCost } from "../storage/usage"
import { resolveUserId, resolveAgentId } from "../storage/onboarding"
import type { ContentPart } from "../multimodal/types"

/**
 * Execute a tool by name from the available tools list
 * This is a local helper function since executeTool is not exported elsewhere
 *
 * Returns: JS object normal (se encodea solo al enviar al LLM)
 */
async function executeTool(
  allTools: Array<{ name: string; execute?: (params: Record<string, unknown>, config?: any) => Promise<unknown> }>,
  toolName: string,
  args: unknown,
  config: { user_id?: string; thread_id?: string; channel?: string; workspace?: string | null }
): Promise<unknown> {
  const tool = allTools.find(t => t.name === toolName)
  if (!tool?.execute) {
    return { error: true, message: `Tool '${toolName}' not found or not executable` }
  }
  try {
    const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args
    return await tool.execute(parsedArgs as Record<string, unknown>, { configurable: config })
  } catch (err) {
    return {
      error: true,
      tool: toolName,
      message: (err as Error).message,
      timestamp: new Date().toISOString(),
    }
  }
}

const log = logger.child("agent-loop")

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentLoopOptions {
  agentId: string
  userMessage: string | ContentPart[]
  threadId: string
  channel?: string
  mcpManager?: MCPClientManager | null
  /** System prompt override (from server.ts config) */
  systemPromptOverride?: string
  /** Worker mode: isolated context + single-task execution */
  isolated?: boolean
  taskContext?: string | ContentPart[]
  onStep?: (step: StepEvent) => Promise<void>
  /** User ID for context propagation */
  userId?: string
  /** Abort signal to stop generation mid-execution */
  signal?: AbortSignal
  /** Clean text for FTS5 and tracing (extracted from userMessage if multimodal) */
  rawUserMessage?: string
}

export interface StepEvent {
  type: "text" | "tool_call" | "tool_result"
  message: string
  toolName?: string
  isError?: boolean
}

// ─── Stream chunk types (compatible with providers/index.ts) ─────────────────

export interface StreamChunk {
  agent?: { messages: any[] }
  tools?: { messages: any[] }
  usage?: { input_tokens: number; output_tokens: number }
}

// ─── Main agent loop ──────────────────────────────────────────────────────────

export async function* runAgent(
  opts: AgentLoopOptions
): AsyncGenerator<StreamChunk> {
  const t0 = performance.now()
  const db = getDb()

  // Load agent config from DB
  const agent = db.query<any, [string]>("SELECT * FROM agents WHERE id = ?").get(opts.agentId)
  if (!agent) throw new Error(`Agent not found: ${opts.agentId}`)

  const agentName = agent.name || opts.agentId
  const maxIterations = agent.max_iterations || 10

  // Resolve LLM provider config
  const providerCfg = await resolveProviderConfig(
    agent.provider_id || "openai",
    agent.model_id || "gpt-4o-mini"
  )

  const cleanModel = providerCfg.model.replace(new RegExp(`^${providerCfg.provider}\\/`), "")
  log.info(`[agent-loop] Starting: agent=${agentName} thread=${opts.threadId} provider=${providerCfg.provider}/${cleanModel}`)

  emitCanvas("canvas:node_update", {
    nodeId: opts.agentId,
    changes: { status: "thinking" },
  })

  // Store the user message in conversation history
  if (!opts.isolated) {
    // If userMessage is multimodal, addMessage extracts text for history storage
    addMessage(opts.threadId, "user", opts.userMessage, { channel: opts.channel })
    // Run compaction if conversation history is getting large
    await maybeCompact(
      opts.threadId,
      opts.channel && opts.userId
        ? { channel: opts.channel, userId: opts.userId }
        : undefined
    )
  }

  // Compile context (system prompt + history + tools)
  const ctx = await compileContext({
    agentId: opts.agentId,
    threadId: opts.threadId,
    userMessage: opts.userMessage,
    channel: opts.channel,
    mcpManager: opts.mcpManager,
    isolated: opts.isolated,
    taskContext: opts.taskContext,
    userId: opts.userId,
  })

  const systemPrompt = opts.systemPromptOverride || ctx.systemPrompt

  // Build initial messages array for the model
  let messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    ...ctx.messages,
  ]

  // For isolated workers the user message is the task context, not from history
  if (opts.isolated) {
    messages.push({ role: "user", content: opts.userMessage })
  }

  let iterations = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let finalContent = ""
  // Loop detection: track last tool call signature to break identical consecutive calls
  let lastToolSignature = ""
  let consecutiveRepeat = 0
  let loopDetected = false

  // ── The loop ────────────────────────────────────────────────────────────
  while (iterations < maxIterations) {
    if (opts.signal?.aborted) {
      log.info(`[agent-loop] Aborted by signal at iteration ${iterations}`)
      finalContent = "Generación detenida."
      break
    }

    iterations++

    const response = await callLLM({
      ...providerCfg,
      messages: clearOldToolResults(messages) as LLMMessage[],
      tools: ctx.tools.length > 0 ? ctx.tools : undefined,
    })

    // Accumulate usage
    if (response.usage) {
      totalInputTokens += response.usage.input_tokens
      totalOutputTokens += response.usage.output_tokens
    }

    // Emit agent chunk (compatible with providers/index.ts)
    const agentMsg: any = { content: response.content }
    if (response.tool_calls?.length) agentMsg.tool_calls = response.tool_calls
    yield { agent: { messages: [agentMsg] } }

    // Notify onStep for narration text
    if (opts.onStep && response.content) {
      await opts.onStep({ type: "text", message: response.content })
    }

    // ── No tool calls → final response ──────────────────────────────────
    if (!response.tool_calls?.length || response.stop_reason !== "tool_calls") {
      finalContent = response.content?.trim() || ""
      // Only save to history if we have real content; empty → synthesis block will handle it
      if (finalContent && !opts.isolated) {
        addMessage(opts.threadId, "assistant", finalContent)
      }
      break
    }

    // ── Tool calls → execute each tool ──────────────────────────────────
    // Add assistant message with tool_calls to local messages array AND persist
    messages.push({
      role: "assistant",
      content: response.content,
      tool_calls: response.tool_calls,
      reasoning_content: response.reasoning_content,
    })
    if (!opts.isolated) {
      addMessage(opts.threadId, "assistant", response.content || "", {
        channel: opts.channel,
        tool_calls: response.tool_calls,
        reasoning_content: response.reasoning_content,
      })
    }

    for (const tc of response.tool_calls) {
      const toolName = tc.function.name

      emitCanvas("canvas:node_update", {
        nodeId: opts.agentId,
        changes: { status: "tool_call", currentTool: toolName },
      })

      if (opts.onStep) {
        if (response.content) {
          await opts.onStep({ type: "text", message: response.content })
        }
        await opts.onStep({
          type: "tool_call",
          toolName,
          message: `Calling tool: \`${toolName}\``,
        })
      }

      const tTool = performance.now()
      const toolResultJS = await executeTool(
        ctx.allTools,
        toolName,
        tc.function.arguments,
        {
          user_id: opts.userId,
          thread_id: opts.threadId,
          channel: opts.channel,
          workspace: agent.workspace ?? null,
        }
      )
      const toolMs = Math.round(performance.now() - tTool)

      // Encode TOON only for LLM consumption (with cost calculation)
      const toolResultLLM = formatToolResult(toolResultJS, cleanModel)

      log.info(`[agent-loop] Tool ${toolName} completed in ${toolMs}ms`)

      // Log tool result preview (truncated to avoid flooding logs)
      const resultPreview = toolResultLLM.length > 500
        ? toolResultLLM.substring(0, 500) + `… (+${toolResultLLM.length - 500} chars)`
        : toolResultLLM
      log.info(`[agent-loop] Tool result [${toolName}]: ${resultPreview}`)

      // Extract text for trace summary
      const textMessage = typeof opts.userMessage === "string"
        ? opts.userMessage
        : Array.isArray(opts.userMessage)
          ? opts.userMessage.filter(p => p.type === "text").map(p => (p as any).text).join("\n")
          : String(opts.userMessage)

      // Clean timestamp from message for trace
      const cleanMessage = textMessage.replace(/^\[Timestamp:.*?\]\n/, "")

      // Save tool call trace
      saveTrace({
        threadId: opts.threadId,
        agentId: opts.agentId,
        agentName,
        toolUsed: toolName,
        inputSummary: `${cleanMessage.substring(0, 200)} → ${toolName}`,
        outputSummary: toolResultLLM.substring(0, 300),
        success: !toolResultLLM.startsWith("[Tool Error]"),
        errorMessage: toolResultLLM.startsWith("[Tool Error]") ? toolResultLLM : null,
        durationMs: toolMs,
      })

      // Emit tool chunk (TOON encoded for LLM)
      yield { tools: { messages: [{ content: toolResultLLM, tool_call_id: tc.id }] } }

      if (opts.onStep) {
        await opts.onStep({ type: "tool_result", message: toolResultLLM })
      }

      // Add tool result to messages for next model call AND persist (TOON encoded)
      messages.push({
        role: "tool",
        content: toolResultLLM,
        tool_call_id: tc.id,
      })
      if (!opts.isolated) {
        addMessage(opts.threadId, "tool", toolResultLLM, {
          channel: opts.channel,
          tool_call_id: tc.id,
        })
      }

      // Dynamic tool injection: when search_knowledge finds tools (native or MCP), add them to ctx.tools
      if (toolName === "search_knowledge") {
        // Use JS object directly (no parse needed)
        try {
          const result = toolResultJS as any
          const foundTools: Array<{ name: string }> = result?.tools ?? []
          const foundMcpTools: Array<{ tool_name: string; full_name?: string; id?: string }> = result?.toolsmcp ?? []
          const currentToolNames = new Set(ctx.tools.map((t: any) => t.function?.name))

          // Track which tools were injected for skill lookup
          const injectedTools: string[] = []

          // Inject native tools
          for (const found of foundTools) {
            if (!currentToolNames.has(found.name)) {
              const nativeTool = ctx.allTools.find(t => t.name === found.name)
              if (nativeTool) {
                ctx.tools.push({
                  type: "function",
                  function: {
                    name: nativeTool.name,
                    description: (nativeTool as any).description ?? "",
                    parameters: (nativeTool as any).parameters ?? { type: "object", properties: {} },
                  },
                })
                log.info(`[agent-loop] Injected discovered native tool into loadout: ${nativeTool.name}`)
                currentToolNames.add(found.name)
                injectedTools.push(nativeTool.name)
              }
            }
          }

          // Inject MCP tools discovered via search_knowledge(type="mcp")
          for (const found of foundMcpTools) {
            // Use full_name (sanitized compound id) because ctx.allTools stores MCP tools
            // under the sanitized name (e.g. "Instagram__mis_estadisticas_de_instagram"),
            // NOT the original tool_name (e.g. "mis estadisticas de instagram").
            const mcpFullName = found.full_name || found.id
            log.debug(`[agent-loop] MCP discovery candidate: tool_name="${found.tool_name}", full_name="${found.full_name}", id="${found.id}", resolved="${mcpFullName}"`)
            if (!currentToolNames.has(mcpFullName)) {
              const mcpTool = ctx.allTools.find(t => t.name === mcpFullName)
              if (mcpTool) {
                ctx.tools.push({
                  type: "function",
                  function: {
                    name: mcpTool.name,
                    description: (mcpTool as any).description ?? "",
                    parameters: (mcpTool as any).parameters ?? { type: "object", properties: {} },
                  },
                })
                log.info(`[agent-loop] Injected discovered MCP tool into loadout: ${mcpTool.name}`)
                currentToolNames.add(mcpFullName)
              } else {
                log.warn(`[agent-loop] MCP tool "${mcpFullName}" not found in allTools (available MCP: ${ctx.allTools.filter(t => t.name.includes('__')).map(t => t.name).join(', ')})`)
              }
            }
          }

          // Inject skills associated with the injected tools
          if (injectedTools.length > 0) {
            try {
              const db = getDb()
              // Find skills that use any of the injected tools
              const placeholders = injectedTools.map(() => "?").join(",")
              const skillsWithTools = db.query(`
                SELECT DISTINCT s.name, s.body, s.tools
                FROM skills s
                WHERE s.active = 1
                AND (
                  ${injectedTools.map(() => `s.tools LIKE ?`).join(" OR ")}
                )
              `).all(...injectedTools.map(t => `%${t}%`)) as Array<{ name: string; body: string; tools: string }>

              // Filter to only skills that actually contain the tools (not partial matches)
              const matchingSkills = skillsWithTools.filter(s => {
                const skillTools = s.tools?.split(",").map(t => t.trim()) ?? []
                return injectedTools.some(injected => skillTools.includes(injected))
              })

              if (matchingSkills.length > 0) {
                const skillSection = matchingSkills
                  .map(s => `## Skill: ${s.name}\n${s.body}`)
                  .join("\n\n")

                // Add skill instructions to system prompt (first message)
                const systemMsg = messages.find(m => m.role === "system")
                if (systemMsg && typeof systemMsg.content === "string") {
                  // Check if we already added this skill
                  const existingSkillNames = new Set(
                    (systemMsg.content.match(/## Skill: ([^\n]+)/g) || [])
                      .map(m => m.replace("## Skill: ", "").trim())
                  )

                  const newSkills = matchingSkills.filter(s => !existingSkillNames.has(s.name))
                  if (newSkills.length > 0) {
                    const newSkillSection = newSkills
                      .map(s => `## Skill: ${s.name}\n${s.body}`)
                      .join("\n\n")

                    systemMsg.content += `\n\n--- SKILL INSTRUCTIONS (Auto-loaded) ---\n${newSkillSection}`
                    log.info(`[agent-loop] Injected ${newSkills.length} skill(s) for tools: ${newSkills.map(s => s.name).join(", ")}`)
                  }
                }
              }
            } catch (skillErr) {
              log.warn(`[agent-loop] Failed to inject skills for tools: ${(skillErr as Error).message}`)
            }
          }
        } catch (err) {
          log.warn(`[agent-loop] search_knowledge tool injection failed: ${(err as Error).message}`)
        }

        // Enrich the tool result with skill instructions and playbook rules
        try {
          const result = toolResultJS as any
          const foundSkills: Array<{ name: string; body?: string }> = result?.skills ?? []
          const foundPlaybook: Array<{ rule: string; category?: string }> = result?.playbook ?? []

          if (foundSkills.length > 0 || foundPlaybook.length > 0) {
            const extras: string[] = []

            if (foundSkills.some((s: any) => s.body)) {
              const section = foundSkills
                .filter((s: any) => s.body)
                .map((s: any) => `## Skill: ${s.name}\n${s.body}`)
                .join("\n\n")
              extras.push(`\n\n--- SKILL INSTRUCTIONS ---\n${section}`)
            }

            if (foundPlaybook.length > 0) {
              const section = foundPlaybook.map((p: any) => `- [${p.category ?? "general"}] ${p.rule}`).join("\n")
              extras.push(`\n\n--- PLAYBOOK RULES ---\n${section}`)
            }

            if (extras.length > 0) {
              const lastMsg = messages[messages.length - 1]
              if (lastMsg?.role === "tool") {
                lastMsg.content += extras.join("")
                log.info(`[agent-loop] Enriched search_knowledge result with ${foundSkills.length} skill(s) and ${foundPlaybook.length} rule(s)`)
              }
            }
          }
        } catch (err) {
          log.warn(`[agent-loop] search_knowledge enrichment failed: ${(err as Error).message}`)
        }
      }

      // Loop detection: same tool + same args called consecutively → break
      const sig = `${toolName}:${JSON.stringify(tc.function.arguments)}`
      if (sig === lastToolSignature) {
        consecutiveRepeat++
        if (consecutiveRepeat >= 2) {
          log.warn(`[agent-loop] Loop detected: "${toolName}" x${consecutiveRepeat + 1} with same args. Breaking.`)
          finalContent = "No pude completar la tarea porque no encontré las herramientas necesarias para ello."
          loopDetected = true
          break
        }
      } else {
        lastToolSignature = sig
        consecutiveRepeat = 0
      }
    }

    if (loopDetected) break

    emitCanvas("canvas:node_update", {
      nodeId: opts.agentId,
      changes: { status: "thinking", currentTool: null },
    })
  }

  // ── Synthesis call when max iterations hit without a text response ────────
  // The agent spent all iterations on tool calls and never produced a final message.
  // Make one extra call without tools so it summarizes what it did.
  if (!finalContent) {
    log.info(`[agent-loop] Max iterations hit with no text response — requesting synthesis (isolated=${!!opts.isolated})`)
    try {
      messages.push({
        role: "user",
        content: "Basándote en lo que hiciste hasta ahora, responde al usuario con un resumen claro de lo que completaste o del estado actual. Sé conciso.",
      })
      const synthesis = await callLLM({
        ...providerCfg,
        messages: clearOldToolResults(messages) as LLMMessage[],
        tools: undefined, // no tools — force text response
      })
      if (synthesis.usage) {
        totalInputTokens += synthesis.usage.input_tokens
        totalOutputTokens += synthesis.usage.output_tokens
      }
      finalContent = synthesis.content?.trim() || "He completado las tareas solicitadas."
      if (!opts.isolated) {
        addMessage(opts.threadId, "assistant", finalContent)
      }
      yield { agent: { messages: [{ content: finalContent }] } }
    } catch (err) {
      log.warn(`[agent-loop] Synthesis call failed: ${(err as Error).message}`)
      finalContent = "He completado las tareas solicitadas."
      if (!opts.isolated) {
        addMessage(opts.threadId, "assistant", finalContent)
      }
      yield { agent: { messages: [{ content: finalContent }] } }
    }
  }

  // Emit final usage so consumers (e.g. AgentRunner) can surface real token counts
  if (totalInputTokens > 0 || totalOutputTokens > 0) {
    yield { usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens } }
  }

  // ── Post-loop ────────────────────────────────────────────────────────────
  const durationMs = Math.round(performance.now() - t0)

  emitCanvas("canvas:node_update", {
    nodeId: opts.agentId,
    changes: { status: "idle", currentTool: null },
  })

  // Record usage
  recordLLMUsage({
    provider: providerCfg.provider,
    model: providerCfg.model,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  })

  // Extract text for trace summary
  const textMessageFinal = opts.rawUserMessage || (typeof opts.userMessage === "string"
    ? opts.userMessage
    : Array.isArray(opts.userMessage)
      ? opts.userMessage.filter(p => p.type === "text").map(p => (p as any).text).join("\n")
      : String(opts.userMessage))

  // Save overall trace
  const cleanMessageFinal = textMessageFinal.replace(/^\[Timestamp:.*?\]\n/, "")
  saveTrace({
    threadId: opts.threadId,
    agentId: opts.agentId,
    agentName,
    inputSummary: cleanMessageFinal.substring(0, 300),
    outputSummary: finalContent.substring(0, 300),
    success: true,
    durationMs,
    tokensUsed: totalInputTokens + totalOutputTokens,
  })

  log.info(
    `[agent-loop] Done: agent=${agentName} iterations=${iterations} ` +
    `tokens=${totalInputTokens + totalOutputTokens} elapsed=${durationMs}ms`
  )
}

// ─── Isolated worker execution (Fase 4.4) ───────────────────────────────────

/**
 * Run a worker agent in an isolated context.
 * Returns the final response string.
 */
export async function runAgentIsolated(opts: {
  agentId: string
  taskDescription: string | ContentPart[]
  threadId: string
  mcpManager?: MCPClientManager | null
}): Promise<string> {
  let lastContent = ""
  for await (const chunk of runAgent({
    agentId: opts.agentId,
    userMessage: opts.taskDescription,
    threadId: opts.threadId,
    isolated: true,
    taskContext: opts.taskDescription,
    mcpManager: opts.mcpManager,
  })) {
    if (chunk.agent?.messages?.[0]?.content) {
      lastContent = chunk.agent.messages[0].content
    }
  }
  return lastContent
}

// ─── Shim: AgentLoop class with stream() compatible with providers/index.ts ──

export class AgentLoop {
  private mcpManager: MCPClientManager | null = null

  setMCPManager(m: MCPClientManager) {
    this.mcpManager = m
  }

  /**
   * Returns an async iterable that emits chunks compatible with
   * the existing providers/index.ts stream consumer.
   */
  stream(
    input: { messages: Array<{ role: string; content: string | ContentPart[] }> },
    config: {
      configurable?: {
        thread_id?: string
        agent_id?: string
        user_id?: string
        system_prompt?: string
        channel?: string
        raw_user_message?: string
      }
      signal?: AbortSignal
    }
  ): AsyncIterable<StreamChunk> {
    // Resolve from database with priority: explicit param → DB lookup → single user/agent
    const threadId = config.configurable?.thread_id || resolveUserId({}) || "default"
    const agentId = config.configurable?.agent_id || resolveAgentId(config.configurable?.agent_id) || this._resolveCoordinatorId() || "main"
    const systemPromptOverride = config.configurable?.system_prompt
    const channel = config.configurable?.channel
    const userId = config.configurable?.user_id || resolveUserId({
      channel: config.configurable?.channel ? (config.configurable?.channel as string).split(':')[0] : null,
      channelUserId: config.configurable?.thread_id
    })

    // Log MCP Manager status
    log.info(`[AgentLoop.stream] MCP Manager available: ${this.mcpManager !== null}`)
    if (this.mcpManager) {
      try {
        const servers = this.mcpManager.listServers?.() || []
        log.info(`[AgentLoop.stream] MCP servers: ${servers.length} registered`)
        for (const s of servers) {
          log.info(`  - ${s.name}: ${s.status} (${s.tools?.length || 0} tools)`)
        }
      } catch (e) {
        log.warn(`[AgentLoop.stream] Failed to list MCP servers: ${(e as Error).message}`)
      }
    }

    // Extract the last user message from the input
    const lastUserMsg = [...input.messages].reverse().find((m) => m.role === "user")
    const userMessage = lastUserMsg?.content || ""

    // Use clean message (without timestamp) for FTS5 selectors
    const rawUserMessage = config.configurable?.raw_user_message || 
      (typeof userMessage === "string" ? userMessage : userMessage.filter(p => p.type === "text").map(p => (p as any).text).join("\n"))

    return runAgent({
      agentId,
      userMessage, // FULL MULTIMODAL MESSAGE
      rawUserMessage, // CLEAN TEXT for FTS5
      threadId,
      channel,
      systemPromptOverride,
      mcpManager: this.mcpManager,
      userId,
      signal: config.signal,
    })
  }

  private _resolveCoordinatorId(): string {
    // Use the storage helper to get coordinator agent ID from database
    const coordinatorId = resolveAgentId(null);
    return coordinatorId || "main";
  }
}

// Singleton
let _agentLoop: AgentLoop | null = null

export function getAgentLoop(): AgentLoop | null {
  return _agentLoop
}

export function buildAgentLoop(opts: { mcpManager?: MCPClientManager | null } = {}): AgentLoop {
  _agentLoop = new AgentLoop()
  if (opts.mcpManager) {
    _agentLoop.setMCPManager(opts.mcpManager)
    log.info("[buildAgentLoop] MCP Manager set successfully")
  } else {
    log.warn("[buildAgentLoop] No MCP Manager provided, agent will not have MCP tools")
  }
  return _agentLoop
}

export async function rebuildAgentLoop(opts: { mcpManager?: MCPClientManager | null } = {}): Promise<AgentLoop> {
  _agentLoop = null
  return buildAgentLoop(opts)
}
