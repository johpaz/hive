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
import { col, fromIndexable } from "../storage/hive"
import { getHiveDb } from "../storage/hivedb"
import type { HiveDB, EventInput } from "@johpaz/hive-db"
import type { AgentDoc } from "../storage/collections"
import { callLLM, resolveProviderConfig, getDefaultLLM, type LLMMessage } from "./llm-client"
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
import { loadConfig } from "../config/loader"
import { executeToolBatch } from "../tool-runtime"
import { createStuckLoopDetector, getInterventionMessage, type StuckLoopState } from "./stuck-loop"
import {
  createRun as createAgentRun,
  checkpoint as checkpointRun,
  completeRun,
  failRun,
  interruptRun,
  getRun,
  reclaimRun,
  deserializeCheckpoint,
  bumpTurn,
  startLeaseRenewal,
  stopLeaseRenewal,
  type RunCheckpointState,
} from "./run-store"

const log = logger.child("agent-loop")

// Per-operation budget for a single LLM call — NOT an aggregate deadline for the
// whole turn. Each call gets its own fresh window; a slow-but-healthy multi-step
// turn (many quick operations) is never killed just for taking a while overall.
const LLM_CALL_TIMEOUT_MS = 3 * 60 * 1000

export class LLMCallTimeoutError extends Error {
  constructor(ms: number) {
    super(`LLM call timed out after ${ms}ms`)
    this.name = "LLMCallTimeoutError"
  }
}

/** Bounds a single async operation to its own timeout window, independent of any caller. */
export async function withTimeout<T>(op: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LLMCallTimeoutError(timeoutMs)), timeoutMs)
  })
  try {
    return await Promise.race([op(), timeout])
  } finally {
    clearTimeout(timer!)
  }
}

/**
 * Append one G9 causal event (IntentLogged/StateTransition/ToolCall) to HiveDB's
 * event log. Never throws: a broken causal log must never break the agent loop.
 * See hiveBD's docs/AGENT_INTEGRATION.md for the payload vocabulary contract.
 */
async function appendCausalEvent(
  db: HiveDB,
  input: {
    agentId: string
    streamId: string
    kind: EventInput["kind"]
    payload: Record<string, unknown>
    causation?: number
    correlation?: string
  }
): Promise<number | undefined> {
  try {
    return await db.append({
      agentId: input.agentId,
      streamId: input.streamId,
      kind: input.kind,
      payload: JSON.stringify(input.payload),
      causation: input.causation,
      correlation: input.correlation,
    })
  } catch (err) {
    log.warn(`[agent-loop] causal event append failed (kind=${input.kind}): ${(err as Error).message}`)
    return undefined
  }
}

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
  onToken?: (token: string) => void
  /** Live reasoning/thinking tokens as they stream, for display only. */
  onReasoningToken?: (token: string) => void
  /** User ID for context propagation */
  userId?: string
  /** Abort signal to stop generation mid-execution */
  signal?: AbortSignal
  /** Clean text for search selectors and tracing (extracted from userMessage if multimodal) */
  rawUserMessage?: string
  /** Extra tools to force into the LLM loadout (used by tests/evals). */
  extraTools?: any[]
  /** Run ID for an existing AgentRun — enables resume from checkpoint */
  runId?: string
  /** Whether to resume from a previously saved checkpoint */
  resume?: boolean
  /** Run budget — overrides agent.max_iterations when set */
  budget?: {
    maxIterations?: number
    maxTurns?: number | null
    maxTokens?: number | null
  }
  /** Goal-based continuation parameters */
  goal?: {
    text: string
    checkTool?: string
  }
  /** Whether to checkpoint this run durably (default false for chat; auto-promoted for long turns) */
  durable?: boolean
  /** Kind of run for the AgentRun record */
  runKind?: "chat" | "worker" | "goal" | "cron" | "project"
}

export type { StepEvent as AgentStepEvent }

export interface StepEvent {
  type: "text" | "tool_call" | "tool_result"
  message: string
  toolName?: string
  isError?: boolean
}

// ─── Stream chunk types (compatible with providers/index.ts) ─────────────────

export interface StreamChunk {
  agent?: { messages: any[]; streamed?: boolean }
  tools?: { messages: any[] }
  usage?: { input_tokens: number; output_tokens: number }
}

// ─── Main agent loop ──────────────────────────────────────────────────────────

export async function* runAgent(
  opts: AgentLoopOptions
): AsyncGenerator<StreamChunk> {
  const t0 = performance.now()

  // Load agent config from DB
  const agentsCol = await col<AgentDoc>("agents")
  const agentEntry = await agentsCol.get(opts.agentId)
  if (!agentEntry) throw new Error(`Agent not found: ${opts.agentId}`)
  const agent = agentEntry.doc

  const agentName = agent.name || opts.agentId
  const maxIterations = opts.budget?.maxIterations ?? agent.max_iterations ?? 10

  // ── Durable run tracking ─────────────────────────────────────────────────
  let runId: string | null = opts.runId ?? null
  let isDurable = !!opts.durable || !!opts.runId || !!opts.goal
  const runKind = opts.runKind ?? (opts.isolated ? "worker" : "chat")
  const DURABLE_PROMOTION_THRESHOLD = 6 // promote chat to durable after N iterations

  // ── G9 causal event log (HiveDB) ─────────────────────────────────────────
  // One stream per invocation (a chat turn, or a runAgentIsolated() task) — NOT
  // the persistent chat threadId, since causalThread() reconstructs without a
  // checkpointed projection and a months-old thread would be O(full history)
  // on every call. On resume, opts.runId is reused so the stream isn't split.
  const causalLogEnabled = !!loadConfig().causalLog?.enabled
  const causalDb = causalLogEnabled ? await getHiveDb() : null
  const causalStreamId = opts.runId || crypto.randomUUID()
  // hive has no mid-turn topic-change classifier yet, so the whole stream shares
  // one correlation id. objectiveDrift is technically wired but won't fire in
  // practice until that heuristic exists (documented v1 limitation).
  const causalCorrelationId = crypto.randomUUID()
  let lastCausalSeq: number | undefined
  if (causalDb) {
    const intentText = opts.rawUserMessage || (typeof opts.userMessage === "string"
      ? opts.userMessage
      : Array.isArray(opts.userMessage)
        ? opts.userMessage.filter(p => p.type === "text").map(p => (p as any).text).join("\n")
        : String(opts.userMessage))
    lastCausalSeq = await appendCausalEvent(causalDb, {
      agentId: opts.agentId,
      streamId: causalStreamId,
      kind: "IntentLogged",
      payload: { actor: opts.agentId, intent: intentText.slice(0, 2000) },
      correlation: causalCorrelationId,
    })
  }

  // Stuck-loop protection
  const stuckDetector = createStuckLoopDetector(loadConfig())
  let stuckState: StuckLoopState | undefined

  // Resolve LLM provider config (default from DB when the agent has none configured)
  let agentProvider = fromIndexable(agent.provider_id)
  let agentModel = fromIndexable(agent.model_id)
  if (!agentProvider || !agentModel) {
    const defaultLLM = await getDefaultLLM()
    if (!defaultLLM) throw new Error("No active LLM providers/models configured in the database")
    agentProvider = agentProvider || defaultLLM.provider
    agentModel = agentModel || defaultLLM.model
  }
  const providerCfg = await resolveProviderConfig(agentProvider, agentModel)

  const cleanModel = providerCfg.model.replace(new RegExp(`^${providerCfg.provider}\\/`), "")
  log.info(`[agent-loop] Starting: agent=${agentName} thread=${opts.threadId} provider=${providerCfg.provider}/${cleanModel}`)

  emitCanvas("canvas:node_update", {
    nodeId: opts.agentId,
    changes: { status: "thinking" },
  })

  // Store the user message in conversation history
  if (!opts.isolated) {
    // If userMessage is multimodal, addMessage extracts text for history storage
    await addMessage(opts.threadId, "user", opts.userMessage, { channel: opts.channel })
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
    causalStreamId,
  })

  // Force extra tools into the loadout (tests/evals)
  if (opts.extraTools?.length) {
    const existingNames = new Set(ctx.tools.map((t: any) => t.function?.name))
    for (const tool of opts.extraTools) {
      const name = tool.function?.name || tool.name
      if (name && !existingNames.has(name)) {
        ctx.tools.push(tool)
        existingNames.add(name)
        log.info(`[agent-loop] Force-injected tool into loadout: ${name}`)
      }
    }
  }

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

  // ── Resume from checkpoint ─────────────────────────────────────────────────
  let injectedToolNames: string[] = []
  let systemPromptSkillSections: string[] = []
  let resumedFromPending = false
  let iterations = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let lastToolSignature = ""
  let consecutiveRepeat = 0
  let idleIterations = 0

  if (opts.resume && runId) {
    const existing = await getRun(runId)
    if (existing && existing.state_json) {
      const restored = deserializeCheckpoint(existing)
      if (restored) {
        messages = restored.messages
        injectedToolNames = restored.injectedToolNames ?? []
        systemPromptSkillSections = restored.systemPromptSkillSections ?? []
        iterations = restored.iterations ?? 0
        totalInputTokens = restored.totalInputTokens ?? 0
        totalOutputTokens = restored.totalOutputTokens ?? 0
        lastToolSignature = restored.lastToolSignature ?? ""
        consecutiveRepeat = restored.consecutiveRepeat ?? 0
        idleIterations = restored.idleIterations ?? 0
        if (existing.pending_tool_calls_json) {
          try {
            const pending = JSON.parse(existing.pending_tool_calls_json)
            const interruptedMsgs = pending.map((tc: any) => ({
              role: "tool" as const,
              content: "[interrupted] El proceso se reinició mientras esta herramienta corría. El resultado no está disponible — decidí si reintentar o continuar sin él.",
              tool_call_id: tc.id,
            }))
            messages.push(...interruptedMsgs)
            resumedFromPending = true
            log.info(`[agent-loop] Resume: injected ${interruptedMsgs.length} synthetic [interrupted] tool message(s)`)
          } catch { /* ignore bad json */ }
        }
        log.info(`[agent-loop] Resume: restored ${messages.length} messages, ${iterations} iterations from run ${runId}`)
      }
    }
  }

  // ── Create AgentRun if durable ────────────────────────────────────────────
  if (!runId && isDurable) {
    const run = await createAgentRun({
      thread_id: opts.threadId,
      agent_id: opts.agentId,
      user_id: opts.userId ?? "",
      channel: opts.channel ?? null,
      kind: runKind,
      max_iterations: maxIterations,
      max_turns: opts.budget?.maxTurns ?? null,
      max_tokens: opts.budget?.maxTokens ?? null,
      goal: opts.goal?.text ?? null,
      goal_check_tool: opts.goal?.checkTool ?? null,
      resume_policy: "resume",
    })
    runId = run.id
    log.info(`[agent-loop] Created durable run ${runId} (kind=${runKind})`)
  }

  // Re-running an existing run (e.g. a job re-claimed after a crash): reconcile
  // may have left it "interrupted" with a stale boot_id, and the lease renewer
  // self-stops unless status is "running" — take ownership before executing.
  if (opts.runId && isDurable) {
    await reclaimRun(opts.runId).catch((err) =>
      log.warn(`[agent-loop] Failed to reclaim run ${opts.runId}: ${(err as Error).message}`)
    )
  }

  // Start lease renewal timer if durable
  if (runId && isDurable) {
    startLeaseRenewal(runId)
  }

  // The try wraps the whole loop + synthesis + finalization WITHOUT re-indenting
  // the body: it guarantees the durable run never stays "running" with a live
  // lease when the loop throws or the consumer abandons the generator.
  try {

  let finalContent = ""
  // Whether finalContent was already emitted to the stream (normal completion path
  // yields it at the top of the iteration; internal breaks set finalContent without yielding)
  let finalEmitted = false
  let loopDetected = false
  const PROGRESS_TOOLS = new Set(["browser_type", "browser_click", "browser_navigate"])

  // ── The loop ────────────────────────────────────────────────────────────
  while (iterations < maxIterations) {
    if (opts.signal?.aborted) {
      log.info(`[agent-loop] Aborted by signal at iteration ${iterations}`)
      finalContent = "Generación detenida."
      break
    }

    iterations++

    let streamedThisCall = false
    let response: Awaited<ReturnType<typeof callLLM>>
    try {
      response = await withTimeout(() => callLLM({
        ...providerCfg,
        messages: clearOldToolResults(messages) as LLMMessage[],
        tools: ctx.tools.length > 0 ? ctx.tools : undefined,
        signal: opts.signal,
        onToken: opts.onToken
          ? (token: string) => {
            streamedThisCall = true
            opts.onToken?.(token)
          }
          : undefined,
        onReasoningToken: opts.onReasoningToken,
        // Always requested; each provider decides internally whether/how to honor
        // it based on its own model-capability checks (safe no-op otherwise).
        thinking: { enabled: true },
      }), LLM_CALL_TIMEOUT_MS)
    } catch (err) {
      if (err instanceof LLMCallTimeoutError) {
        log.warn(`[agent-loop] ${err.message} at iteration ${iterations}. Breaking.`)
        finalContent = "El modelo tardó demasiado en responder. Intentá de nuevo o simplificá la consulta."
        break
      }
      throw err
    }

    // Accumulate usage
    if (response.usage) {
      totalInputTokens += response.usage.input_tokens
      totalOutputTokens += response.usage.output_tokens
    }

    // G9: record this LLM response as a causal "decision", chained off the
    // previous decision (or the initial IntentLogged for the first one).
    if (causalDb) {
      const description = response.content?.trim()
        || (response.tool_calls?.length
          ? `Calling ${response.tool_calls.map((tc) => tc.function.name).join(", ")}`
          : "(empty response)")
      const seq = await appendCausalEvent(causalDb, {
        agentId: opts.agentId,
        streamId: causalStreamId,
        kind: "StateTransition",
        payload: { description: description.slice(0, 2000) },
        causation: lastCausalSeq,
        correlation: causalCorrelationId,
      })
      if (seq !== undefined) lastCausalSeq = seq
    }

    // Emit agent chunk (compatible with providers/index.ts)
    const agentMsg: any = { content: response.content }
    if (response.tool_calls?.length) agentMsg.tool_calls = response.tool_calls
    yield { agent: { messages: [agentMsg], streamed: streamedThisCall } }

    // Notify onStep for narration text
    if (opts.onStep && response.content) {
      await opts.onStep({ type: "text", message: response.content })
    }

    // ── No tool calls → final response ──────────────────────────────────
    if (!response.tool_calls?.length || response.stop_reason !== "tool_calls") {
      finalContent = response.content?.trim() || ""
      finalEmitted = true // already yielded above as the agent chunk
      // Only save to history if we have real content; empty → synthesis block will handle it
      if (finalContent && !opts.isolated) {
        await addMessage(opts.threadId, "assistant", finalContent)
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
      thinking_blocks: response.thinking_blocks,
    })
    // Note: assistant messages with tool_calls are NOT persisted to DB.
    // Only the final text response to the user is saved.
    // Tool-call round-tripping happens in-memory via the 'messages' array above.

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
    }

    const hiveConfig = loadConfig()

    // ── Checkpoint: persist pending tool_calls BEFORE execution ──────────────
    // If the process crashes mid-tool, the resume will inject synthetic
    // [interrupted] tool messages instead of re-executing the tool.
    if (runId && isDurable) {
      try {
        await checkpointRun(runId, {
          version: 1,
          messages: [...messages],
          iterations,
          totalInputTokens,
          totalOutputTokens,
          lastToolSignature,
          consecutiveRepeat,
          idleIterations,
          injectedToolNames,
          systemPromptSkillSections,
        }, response.tool_calls)
      } catch (err) {
        log.warn(`[agent-loop] Pre-tool checkpoint failed: ${(err as Error).message}`)
      }
    }

    const toolResults = await executeToolBatch({
      toolCalls: response.tool_calls,
      allTools: ctx.allTools,
      toolConfig: {
        user_id: opts.userId,
        thread_id: opts.threadId,
        channel: opts.channel,
        workspace: agent.workspace ?? null,
      },
      hiveConfig,
      workerPool: hiveConfig.tools?.workerPool,
      signal: opts.signal,
    })

    for (const batchResult of toolResults) {
      const tc = batchResult.toolCall
      const toolName = batchResult.toolName
      const toolResultJS = batchResult.result
      const toolMs = batchResult.durationMs

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
        causalStreamId,
      })

      // G9: record the tool call, caused by the decision that requested it.
      // Canonical outcome shape ("Ok" | "Timeout" | {Err}) — see
      // hiveBD docs/AGENT_INTEGRATION.md; anything else silently counts as Ok.
      if (causalDb) {
        const outcome = batchResult.timedOut
          ? "Timeout"
          : batchResult.ok
            ? "Ok"
            : { Err: batchResult.error?.message ?? toolResultLLM.slice(0, 300) }
        await appendCausalEvent(causalDb, {
          agentId: opts.agentId,
          streamId: causalStreamId,
          kind: "ToolCall",
          payload: { tool: toolName, latency_ms: toolMs, outcome },
          causation: lastCausalSeq,
          correlation: causalCorrelationId,
        })
      }

      // Emit tool chunk (TOON encoded for LLM)
      yield { tools: { messages: [{ content: toolResultLLM, tool_call_id: tc.id }] } }

      if (opts.onStep) {
        await opts.onStep({ type: "tool_result", message: toolResultLLM })
      }

      // Add tool result to messages for next model call (in-memory only, NOT persisted to DB)
      messages.push({
        role: "tool",
        content: toolResultLLM,
        tool_call_id: tc.id,
      })

      // Record tool call for stuck-loop detection
      const errorMessage = toolResultLLM.startsWith("[Tool Error]") ? toolResultLLM : undefined
      stuckDetector.recordToolCall(opts.threadId, toolName, tc.function.arguments as Record<string, unknown>, errorMessage)

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
              let nativeTool = ctx.allTools.find(t => t.name === found.name)
              // Fallback: try alternative naming (dots ↔ underscores for legacy DB names)
              if (!nativeTool) {
                const altName = found.name.includes(".")
                  ? found.name.replace(/\./g, "_")
                  : found.name.replace(/_/g, ".")
                nativeTool = ctx.allTools.find(t => t.name === altName)
                if (nativeTool) {
                  log.info(`[agent-loop] Resolved legacy tool name "${found.name}" → "${nativeTool.name}"`)
                }
              }
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
              } else {
                log.warn(`[agent-loop] search_knowledge returned tool "${found.name}" but no matching executor found in allTools`)
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
              const skillsCol = await col<import("../storage/collections").SkillDoc>("skills")
              // Find skills that use any of the injected tools
              const activeSkills = (await skillsCol.scan({})).filter(e => e.doc.active)
              const skillsWithTools = activeSkills
                .filter(e => injectedTools.some(t => e.doc.tools?.includes(t)))
                .map(e => ({ name: e.doc.name, body: e.doc.body, tools: e.doc.tools }))

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
        }
      } else {
        lastToolSignature = sig
        consecutiveRepeat = 0
      }
    }

    if (loopDetected) break

    // Check for stuck loop after each iteration
    stuckState = stuckDetector.check(opts.threadId)
    if (stuckState.detected) {
      const intervention = getInterventionMessage(stuckState)
      log.warn(`[agent-loop] ${intervention}`)

      if (stuckState.count >= 4) {
        // Critical: break and notify user instead of looping forever
        finalContent = intervention
        loopDetected = true
        emitCanvas("canvas:node_update", {
          nodeId: opts.agentId,
          changes: { status: "stuck", currentTool: stuckState.toolName },
        })
        break
      } else {
        // Warning: inject intervention message so the model changes strategy
        messages.push({
          role: "user",
          content: intervention,
        })
      }
    }

    // Stall detection: browser task inspecting the page repeatedly without acting on it.
    // Only iterations that actually used browser tools count — filesystem/knowledge/etc.
    // tool calls are real progress for non-browser tasks and must not trip this heuristic.
    const usedBrowserTools = toolResults.some((r) => r.toolName.startsWith("browser_"))
    const hadProgress = toolResults.some(
      (r) => PROGRESS_TOOLS.has(r.toolName) && !String(r.result).startsWith("[Tool Error]")
    )
    if (hadProgress) {
      idleIterations = 0
    } else if (usedBrowserTools) {
      idleIterations++
    }
    if (idleIterations >= 3 && idleIterations < 5) {
      const stallMsg = "ADVERTENCIA: Llevas varios pasos sin modificar la página. Si ya completaste el formulario, responde al usuario. Si no, avanza con browser_type/browser_click en lugar de seguir inspeccionando."
      log.warn(`[agent-loop] ${stallMsg}`)
      messages.push({ role: "user", content: stallMsg })
    } else if (idleIterations >= 5) {
      const stallMsg = "No logré avanzar en el formulario después de varios intentos. Puede que la página no sea compatible o que falten instrucciones. Te sugiero revisar la URL o darme más detalles."
      log.warn(`[agent-loop] Stall break: ${stallMsg}`)
      finalContent = stallMsg
      emitCanvas("canvas:node_update", {
        nodeId: opts.agentId,
        changes: { status: "stuck", currentTool: "NO_PROGRESS" },
      })
      break
    }

    emitCanvas("canvas:node_update", {
      nodeId: opts.agentId,
      changes: { status: "thinking", currentTool: null },
    })

    // ── Post-tool checkpoint (pending_tool_calls cleared) ───────────────────
    // Track injected tools for checkpoint
    if (toolResults.some(r => r.toolName === "search_knowledge")) {
      const alreadyTracked = new Set(injectedToolNames)
      for (const tr of toolResults) {
        if (tr.toolName !== "search_knowledge") {
          const nativeTool = ctx.allTools.find(t => t.name === tr.toolName)
          if (nativeTool && !alreadyTracked.has(tr.toolName)) {
            injectedToolNames.push(tr.toolName)
            alreadyTracked.add(tr.toolName)
          }
        }
      }
    }

    // Auto-promote to durable for long-running chat turns
    if (!isDurable && !opts.isolated && iterations >= DURABLE_PROMOTION_THRESHOLD) {
      isDurable = true
      const promoted = await createAgentRun({
        thread_id: opts.threadId,
        agent_id: opts.agentId,
        user_id: opts.userId ?? "",
        channel: opts.channel ?? null,
        kind: "chat",
        max_iterations: maxIterations,
        resume_policy: "resume",
      })
      runId = promoted.id
      startLeaseRenewal(runId)
      log.info(`[agent-loop] Auto-promoted to durable run ${runId} at iteration ${iterations}`)
    }

    if (runId && isDurable) {
      try {
        await checkpointRun(runId, {
          version: 1,
          messages: [...messages],
          iterations,
          totalInputTokens,
          totalOutputTokens,
          lastToolSignature,
          consecutiveRepeat,
          idleIterations,
          injectedToolNames,
          systemPromptSkillSections,
        }, null) // null = no pending tool calls (tools just completed)
      } catch (err) {
        log.warn(`[agent-loop] Post-tool checkpoint failed: ${(err as Error).message}`)
      }
    }

    // Budget check: tokens
    if (opts.budget?.maxTokens && (totalInputTokens + totalOutputTokens) >= opts.budget.maxTokens) {
      log.info(`[agent-loop] Token budget exhausted (${totalInputTokens + totalOutputTokens}/${opts.budget.maxTokens})`)
      break
    }
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
        await addMessage(opts.threadId, "assistant", finalContent)
      }
      yield { agent: { messages: [{ content: finalContent }] } }
    } catch (err) {
      log.warn(`[agent-loop] Synthesis call failed: ${(err as Error).message}`)
      finalContent = "He completado las tareas solicitadas."
      if (!opts.isolated) {
        await addMessage(opts.threadId, "assistant", finalContent)
      }
      yield { agent: { messages: [{ content: finalContent }] } }
    }
  } else if (!finalEmitted) {
    // Internal break (stall, loop detected, stuck, timeout, abort) set finalContent
    // without yielding it — emit and persist it so the user gets a non-empty response
    if (!opts.isolated) {
      await addMessage(opts.threadId, "assistant", finalContent)
    }
    yield { agent: { messages: [{ content: finalContent }] } }
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
    causalStreamId,
  })

  log.info(
    `[agent-loop] Done: agent=${agentName} iterations=${iterations} ` +
    `tokens=${totalInputTokens + totalOutputTokens} elapsed=${durationMs}ms`
  )

  // ── Durable run finalization ──────────────────────────────────────────────
  if (runId && isDurable) {
    // Ensure final iteration count is persisted (loop may have broken before the
    // in-loop post-tool checkpoint was reached, e.g. when LLM returns text immediately).
    try {
      await checkpointRun(runId, {
        version: 1,
        messages: [...messages],
        iterations,
        totalInputTokens,
        totalOutputTokens,
        lastToolSignature,
        consecutiveRepeat,
        idleIterations,
        injectedToolNames,
        systemPromptSkillSections,
      }, null)
    } catch { /* best-effort */ }
    stopLeaseRenewal(runId)
    if (opts.signal?.aborted) {
      await interruptRun(runId, "Generation aborted by signal").catch(() => {})
    } else {
      await completeRun(runId).catch(() => {})
    }
  }

  } catch (err) {
    // The loop threw (LLM/tool error): release the run so reconcile never sees
    // a phantom "running" row with a self-renewing lease.
    if (runId && isDurable) {
      if (opts.signal?.aborted) {
        await interruptRun(runId, "Generation aborted by signal").catch(() => {})
      } else {
        await failRun(runId, (err as Error).message).catch(() => {})
      }
    }
    throw err
  } finally {
    if (runId) {
      stopLeaseRenewal(runId)
      if (isDurable) {
        // Consumer abandoned the generator (break/.return()) before the normal
        // finalization ran: leave the run resumable instead of phantom-running.
        const finalState = await getRun(runId).catch(() => null)
        if (finalState && finalState.status === "running") {
          await interruptRun(runId, "Loop terminated early without finalization").catch(() => {})
        }
      }
    }
  }
}

// ─── Isolated worker execution (Fase 4.4) ───────────────────────────────────

/**
 * Run a worker agent in an isolated context.
 * Returns the final response string.
 *
 * Passing `runId` + `durable` links the run to an existing AgentRun so the
 * worker checkpoints per round-trip and can resume mid-task after a crash.
 */
export async function runAgentIsolated(opts: {
  agentId: string
  taskDescription: string | ContentPart[]
  threadId: string
  mcpManager?: MCPClientManager | null
  runId?: string
  resume?: boolean
  durable?: boolean
  signal?: AbortSignal
}): Promise<string> {
  let lastContent = ""
  for await (const chunk of runAgent({
    agentId: opts.agentId,
    userMessage: opts.taskDescription,
    threadId: opts.threadId,
    isolated: true,
    taskContext: opts.taskDescription,
    mcpManager: opts.mcpManager,
    runId: opts.runId,
    resume: opts.resume,
    durable: opts.durable,
    signal: opts.signal,
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
  async *stream(
    input: { messages: Array<{ role: string; content: string | ContentPart[] }> },
    config: {
      configurable?: {
        thread_id?: string
        agent_id?: string
        user_id?: string
        system_prompt?: string
        channel?: string
        raw_user_message?: string
        /** Durable run options — checkpoint/resume via agentRuns. */
        run_id?: string
        resume?: boolean
        durable?: boolean
      }
      signal?: AbortSignal
      onToken?: (token: string) => void
      onReasoningToken?: (token: string) => void
      onStep?: (step: StepEvent) => Promise<void>
      /** Extra tools to force into the LLM loadout (tests/evals). */
      extraTools?: any[]
    }
  ): AsyncIterable<StreamChunk> {
    // Resolve from database with priority: explicit param → DB lookup → single user/agent
    const threadId = config.configurable?.thread_id || (await resolveUserId({})) || "default"
    const agentId = config.configurable?.agent_id || (await resolveAgentId(config.configurable?.agent_id)) || (await this._resolveCoordinatorId()) || "main"
    const systemPromptOverride = config.configurable?.system_prompt
    const channel = config.configurable?.channel
    const userId = config.configurable?.user_id || (await resolveUserId({
      channel: config.configurable?.channel ? (config.configurable?.channel as string).split(':')[0] : null,
      channelUserId: config.configurable?.thread_id
    }))

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

    // Use clean message (without timestamp) for the search selectors
    const rawUserMessage = config.configurable?.raw_user_message || 
      (typeof userMessage === "string" ? userMessage : userMessage.filter(p => p.type === "text").map(p => (p as any).text).join("\n"))

    yield* runAgent({
      agentId,
      userMessage, // FULL MULTIMODAL MESSAGE
      rawUserMessage, // CLEAN TEXT for search selectors
      threadId,
      channel,
      systemPromptOverride,
      mcpManager: this.mcpManager,
      userId,
      signal: config.signal,
      onToken: config.onToken,
      onReasoningToken: config.onReasoningToken,
      onStep: config.onStep,
      extraTools: config.extraTools,
      runId: config.configurable?.run_id,
      resume: config.configurable?.resume,
      durable: config.configurable?.durable,
      runKind: "chat",
    })
  }

  private async _resolveCoordinatorId(): Promise<string> {
    // Use the storage helper to get coordinator agent ID from database
    const coordinatorId = await resolveAgentId(null);
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
