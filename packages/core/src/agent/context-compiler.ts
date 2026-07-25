/**
 * Context Compiler — Implementa las 4 estrategias de Context Engineering:
 * 
 * 1. ESCRIBIR (Write) — Guardar información fuera del contexto:
 *    - Scratchpad: notas persistentes por conversación
 *    - Trazas de ejecución: registro en traces table
 * 
 * 2. SELECCIONAR (Select) — Traer solo lo relevante:
 *    - Tool Loadout: máx 3-5 tools relevantes por turno
 *    - Playbook filtering: reglas ACE aplicables a esta tarea
 *    - Historial selectivo: resumen + mensajes recientes
 * 
 * 3. COMPRIMIR (Compress) — Reducir tokens manteniendo información:
 *    - Compaction: resumir mensajes viejos
 *    - Tool result clearing: reemplazar resultados antiguos por resúmenes
 * 
 * 4. AISLAR (Isolate) — Separar contextos por agente:
 *    - Cada worker recibe su propio contexto mínimo
 *    - El Coordinador ve el panorama completo
 * 
 * TODOS los datos se formatean en TOON para ahorro de tokens.
 */

import { col, fromIndexable } from "../storage/hive"
import type { AgentDoc, ModelDoc } from "../storage/collections"
import { logger } from "../utils/logger"
import type { LLMMessage, LLMToolDef, ContentPart } from "./llm-client"
import type { MCPClientManager } from "@johpaz/hive-agents-mcp"
import { syncToolCatalogToIndex, mcpToolFullName } from "./tool-selector"
import { syncSkillsToIndex, getMinimalSkills, selectSkills, getSkillByName, type SkillDescriptor } from "./skill-selector"
import { syncPlaybookToIndex, selectPlaybookRules } from "./playbook-selector"
import { getRecentMessages, getSummary, getScratchpad, toAPIMessages } from "./conversation-store"
import { formatContext, estimateTokens } from "../utils/toon"
import { buildSystemPromptWithProjects } from "./prompt-builder"
import { createAllTools } from "../tools/index.ts"
import { resolveUserId } from "../storage/onboarding"
import { getMCPManager as getSingletonMCPManager } from "../mcp/singleton"
import { syncMCPToolsToDB, syncMCPToolsToIndex } from "../mcp/tool-sync"
import { getUserDate, getUserTime } from "../utils/date"
import { loadConfig } from "../config/loader"
import { getHiveDb } from "../storage/hivedb"
import { listCatalogAgents, renderAgentRoutingCatalog } from "./catalog-selector"
import { expandToolAllowlist } from "./delegation-runtime"
import { MINIMAL_TOOLS } from "./minimal-loadout"

const log = logger.child("context-compiler")

// Configuration constants
const KEEP_LAST_N_MESSAGES = 15      // Always keep last N messages (Strategy: SELECT) — only user+assistant text, no tool results
const DEFAULT_CONTEXT_WINDOW = 250000 // Default context window when model is unknown
const COMPACT_RATIO = 0.80           // Reserve budget: truncate system prompt when it would exceed 80% of context window
const MAX_SYSTEM_PROMPT_CHARS_CAP = 128000 // Hard cap for pathological prompts; normal budget is model-aware
const MCP_LAZY_CONNECT_TIMEOUT_MS = 8000 // Bound for on-demand connect of a dormant MCP server
const SUMMARY_MAX_CHARS = 4000       // Cap the compacted summary so it can't itself blow the system-prompt budget



/** Bounds a dormant MCP server's on-demand wake so one dead server can't stall a whole turn. */
async function withMcpConnectTimeout(op: () => Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`MCP connect timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    await Promise.race([op(), timeout])
  } finally {
    clearTimeout(timer!)
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

// Simple tool interface for context compilation
export interface ContextTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute?: (params: Record<string, unknown>) => Promise<unknown>
  /** Per-tool timeout (ms) override from the Tool definition. */
  timeoutMs?: number
}

export interface CompiledContext {
  systemPrompt: string
  /** The `# RESUMEN DE LA CONVERSACIÓN` block already folded into `systemPrompt` — exposed so a caller-supplied `systemPromptOverride` can compose it in instead of discarding it (see agent-loop.ts). "" when compaction hasn't fired. */
  conversationSummarySection: string
  messages: LLMMessage[]
  tools: LLMToolDef[]
  allTools: ContextTool[]
  skills: SkillDescriptor[]  // Skills loaded (minimal + discovered)
}

// ─── G9 causal context (buildAgentContext) ────────────────────────────────

interface AgentContextItemShape {
  type: "decision" | "toolCall" | "anomaly" | "episode" | "phaseSummary"
  seq?: number
  phase?: string
  text?: string
  taskId?: string
  summary?: string
  keyDecisions?: number[]
}

interface AgentContextShape {
  items: AgentContextItemShape[]
  similarEpisodes: Array<{ taskId: string; summary: string }>
  anomalies: AgentContextItemShape[]
}

function formatCausalContextItem(item: AgentContextItemShape): string | null {
  switch (item.type) {
    case "decision":
    case "toolCall":
    case "phaseSummary":
      return item.text ? `- ${item.text}` : null
    case "anomaly":
      return item.text ? `- ⚠ ${item.text}` : null
    case "episode":
      return item.summary ? `- (episodio previo) ${item.summary}` : null
    default:
      return null
  }
}

/** Maps the stored AgentDoc (sentinel-encoded FKs) to the shape context-compiler works with. */
function fromAgentDoc(doc: AgentDoc) {
  return {
    id: doc.id,
    user_id: doc.user_id,
    name: doc.name,
    role: doc.role,
    system_prompt: doc.system_prompt,
    tone: doc.tone,
    provider_id: fromIndexable(doc.provider_id),
    model_id: fromIndexable(doc.model_id),
    tools_json: doc.tools_json,
    tool_allowlist_json: doc.tool_allowlist_json,
    skills_json: doc.skills_json,
    active_mcp_json: doc.active_mcp_json,
    source: doc.source,
    max_iterations: doc.max_iterations,
    workspace: doc.workspace,
  }
}

// ─── Main compiler ─────────────────────────────────────────────────────────

/**
 * Compile context for agent execution implementing 4 strategies:
 *   1. WRITE - Load scratchpad notes
 *   2. SELECT - Tool loadout, playbook rules, selective history
 *   3. COMPRESS - Use summaries, clear old tool results
 *   4. ISOLATE - Worker gets minimal context
 */
export async function compileContext(opts: {
  agentId: string
  threadId: string
  userId?: string
  userMessage: string | ContentPart[]
  channel?: string
  isolated?: boolean
  taskContext?: string | ContentPart[]
  mcpManager?: MCPClientManager | null
  /** G9 causal stream id for this invocation (agent-loop.ts's causalStreamId). */
  causalStreamId?: string
}): Promise<CompiledContext> {
  const { agentId, threadId, mcpManager, userMessage, isolated, taskContext } = opts

  // Fallback: Get MCP Manager from singleton if not provided
  const effectiveMcpManager = mcpManager ?? (() => {
    const singletonMcp = getSingletonMCPManager()
    if (singletonMcp) {
      log.info(`[context-compiler] Using MCP Manager from singleton`)
      return singletonMcp
    }
    return null
  })()

  // Resolve userId from database with priority: explicit param → channel identity → single user
  const userId = opts.userId || (await resolveUserId({
    threadId,
    channel: opts.channel,
    channelUserId: threadId
  })) || threadId || ""

  // [STEP-1] Load agent config
  log.info(`[context-compiler] [STEP-1] Loading agent config for id=${agentId}`)
  let agent: ReturnType<typeof fromAgentDoc>
  try {
    const agentsCol = await col<AgentDoc>("agents")
    const entry = await agentsCol.get(agentId)
    agent = entry ? fromAgentDoc(entry.doc) : undefined
  } catch (err) {
    log.error(`[context-compiler] [STEP-1] ❌ FAILED loading agent: ${JSON.stringify(err)}`)
    throw err
  }

  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`)
  }

  const isWorker = agent.role === 'worker' || !!isolated
  // A catalog-seeded agent (agent-catalog.ts) has its loadout fully
  // curated (tool_allowlist_json/skills_json/mcp scope) — plain agent_create
  // workers and the coordinator get the open/minimal defaults below instead.
  const isCatalogAgent = agent.source === "catalog"
  log.info(`[context-compiler] [STEP-1] ✅ Compiling for ${isWorker ? 'worker' : 'coordinator'} agent=${agent.name}`)

  // Load model's context window for compaction decisions
  let modelContextWindow = DEFAULT_CONTEXT_WINDOW
  if (agent.model_id) {
    try {
      const modelsCol = await col<ModelDoc>("models")
      const modelEntry = await modelsCol.get(agent.model_id.replace(/^[^/]+\//, ''))
      if (modelEntry?.doc.context_window) modelContextWindow = modelEntry.doc.context_window
    } catch { /* use default */ }
  }

  // [STEP-2] STRATEGY 1: WRITE — Load scratchpad (persistent notes)
  log.info(`[context-compiler] [STEP-2] Loading scratchpad...`)
  let scratchpadNotes: Awaited<ReturnType<typeof getScratchpad>> = []
  try {
    scratchpadNotes = await getScratchpad(threadId)
    log.info(`[context-compiler] [STEP-2] ✅ Loaded ${scratchpadNotes.length} scratchpad notes`)
  } catch (err) {
    log.error(`[context-compiler] [STEP-2] ❌ FAILED loading scratchpad: ${JSON.stringify(err)}`)
    throw err
  }

  // [STEP-3c] Load MCP tools (executors only — index sync happens here too)
  log.info(`[context-compiler] [STEP-3c] Loading MCP tools...`)
  const mcpToolExecutors: ContextTool[] = []

  if (effectiveMcpManager) {
    try {
      const mcpServersCol = await col<import("../storage/collections").McpServerDoc>("mcpServers")
      const activeMcpIds = new Set<string>(
        agent.active_mcp_json ? JSON.parse(agent.active_mcp_json) : [],
      )
      const dbServers = (await mcpServersCol.scan({}))
        .map(e => e.doc)
        .filter(s => s.enabled && (!isCatalogAgent || activeMcpIds.has(s.id)))

      for (const server of dbServers) {
        // Try ID first (normalized), then name
        let resolvedServerKey = server.id
        let serverTools = effectiveMcpManager.getServerTools(server.id)
        if (!serverTools || serverTools.length === 0) {
          resolvedServerKey = server.name
          serverTools = effectiveMcpManager.getServerTools(server.name)
        }

        // Lazy wake: the server is registered but dormant (no agent has leased
        // it yet). Connect on demand so the coordinator isn't permanently cut off
        // from tools nothing else ever wakes.
        if (!serverTools || serverTools.length === 0) {
          for (const key of [server.id, server.name]) {
            try {
              await withMcpConnectTimeout(() => effectiveMcpManager!.connectServer(key), MCP_LAZY_CONNECT_TIMEOUT_MS)
              const woken = effectiveMcpManager.getServerTools(key)
              if (woken && woken.length > 0) {
                resolvedServerKey = key
                serverTools = woken
                break
              }
            } catch (err) {
              log.warn(`[context-compiler] [STEP-3c] Lazy connect failed for ${server.name} (${key}): ${(err as Error).message}`)
            }
          }
        }

        if (serverTools && serverTools.length > 0) {
          log.info(`[context-compiler] [STEP-3c] Server ${server.name}: ${serverTools.length} tools`)

          for (const mcpTool of serverTools) {
            // Sanitized name valid for all LLM providers (no spaces, max 64 chars)
            const fullName = mcpToolFullName(server.name, mcpTool.name)

            // Skip tools whose sanitized name is empty or fails provider validation
            if (!fullName || !/^[a-zA-Z0-9_-]{1,64}$/.test(fullName)) {
              log.warn(`[context-compiler] Skipping MCP tool with unsupported name: "${mcpTool.name}" (server: ${server.name}, sanitized: "${fullName}")`)
              continue
            }

            // Executor for agent-loop (has the real call)
            mcpToolExecutors.push({
              name: fullName,
              description: mcpTool.description || `Tool from ${server.name}`,
              parameters: mcpTool.inputSchema || { type: "object", properties: {} },
              execute: async (params: Record<string, unknown>) => {
                // Return raw JS value — agent-loop will TOON-encode via formatToolResult.
                // Never pre-stringify here: formatToolResult(string) double-encodes.
                return await effectiveMcpManager.callTool(resolvedServerKey, mcpTool.name, params)
              },
            })

          }
        } else {
          log.warn(`[context-compiler] [STEP-3c] Server ${server.name} has no tools (not connected yet)`)
        }
      }

      log.info(`[context-compiler] [STEP-3c] ✅ Loaded ${mcpToolExecutors.length} MCP tools`)

      // Persist MCP tool definitions to DB for search_knowledge (HiveDB index)
      if (mcpToolExecutors.length > 0) {
        try {
          for (const server of dbServers) {
            let serverTools = effectiveMcpManager!.getServerTools(server.id)
            if (!serverTools || serverTools.length === 0) {
              serverTools = effectiveMcpManager!.getServerTools(server.name)
            }
            if (serverTools && serverTools.length > 0) {
              await syncMCPToolsToDB(server.id || server.name, server.name, serverTools)
            }
          }
          await syncMCPToolsToIndex();
          log.info(`[context-compiler] [STEP-3c] ✅ Persisted MCP tools to DB + HiveDB index`)
        } catch (syncErr) {
          log.warn(`[context-compiler] [STEP-3c] ⚠️ Failed to persist MCP tools to DB: ${(syncErr as Error).message}`)
        }
      }
    } catch (err) {
      log.error(`[context-compiler] [STEP-3c] ❌ Failed: ${(err as Error).message}`)
    }
  } else {
    log.info(`[context-compiler] [STEP-3c] ⚠️ No MCP manager, skipping MCP tools`)
  }

  // [STEP-4] Minimal tool set — agent discovers the rest via search_knowledge
  log.info(`[context-compiler] [STEP-4] Building minimal tool set`)

  // [STEP-8] Combine native tools + MCP executors loaded in STEP-3c
  const config = { tools: {} }
  const allNativeTools = createAllTools(config)
  const nativeTools: ContextTool[] = allNativeTools.map(t => ({
    name: t.name,
    description: t.description || "",
    parameters: t.parameters as any,
    execute: t.execute,
    timeoutMs: t.timeoutMs,
  }))

  let allTools = [...nativeTools, ...mcpToolExecutors]

  // Only native minimal tools in LLM context
  // MCP tools are discovered dynamically via search_knowledge(type="mcp")
  let filteredNativeTools: ContextTool[] = nativeTools.filter(t => MINIMAL_TOOLS.has(t.name))
  if (isCatalogAgent) {
    const allowedNames = new Set<string>(
      agent.tool_allowlist_json
        ? expandToolAllowlist(
          JSON.parse(agent.tool_allowlist_json),
          nativeTools.map((tool) => tool.name),
        )
        : agent.tools_json
          ? JSON.parse(agent.tools_json)
          : [],
    )
    filteredNativeTools = nativeTools.filter((tool) => allowedNames.has(tool.name))
    allTools = [...filteredNativeTools, ...mcpToolExecutors]
  }

  const nativeToolsForLLM: LLMToolDef[] = filteredNativeTools.map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))

  let toolsForLLM: LLMToolDef[] = nativeToolsForLLM
  if (isCatalogAgent && mcpToolExecutors.length > 0) {
    toolsForLLM = [
      ...toolsForLLM,
      ...mcpToolExecutors.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    ]
  }

  log.info(`[context-compiler] [STEP-4] Minimal native tool set: ${filteredNativeTools.length} tools`)
  log.info(`[context-compiler] [STEP-4b] MCP tools available via search_knowledge: ${mcpToolExecutors.length} (not injected)`)
  log.info(`[context-compiler] [STEP-8] ✅ Combined tools: ${allTools.length} total executors, ${toolsForLLM.length} in LLM context`)

  // [STEP-8b] STRATEGY 2: SELECT — Skill Loadout (minimal + discovered)
  log.info(`[context-compiler] [STEP-8b] Building skill loadout...`)
  let minimalSkills: SkillDescriptor[] = []
  let discoveredSkills: SkillDescriptor[] = []

  try {
    // Load minimal skills (always available)
    minimalSkills = await getMinimalSkills()
    log.info(`[context-compiler] [STEP-8b] ✅ Loaded ${minimalSkills.length} minimal skills`)

    // Discover additional skills via HiveDB search (coordinator only)
    if (!isWorker) {
      const inputForSkills = taskContext || userMessage
      const textMessage = typeof inputForSkills === "string"
        ? inputForSkills
        : Array.isArray(inputForSkills)
          ? inputForSkills.filter(p => p.type === "text").map(p => (p as any).text).join("\n")
          : String(inputForSkills)
      discoveredSkills = await selectSkills(textMessage)
      log.info(`[context-compiler] [STEP-8b] ✅ Discovered ${discoveredSkills.length} additional skills via HiveDB`)
    }
    if (isCatalogAgent && agent.skills_json) {
      for (const skillId of JSON.parse(agent.skills_json) as string[]) {
        const forced = await getSkillByName(skillId)
        if (forced) discoveredSkills.push(forced)
      }
      log.info(`[context-compiler] [STEP-8b] ✅ Loaded ${discoveredSkills.length} catalog agent skills`)
    }
  } catch (err) {
    log.warn(`[context-compiler] [STEP-8b] ⚠️ Skill loadout failed: ${(err as Error).message}`)
  }

  // Combine skills (minimal + discovered, avoiding duplicates)
  const skillMap = new Map<string, SkillDescriptor>()
  for (const skill of minimalSkills) {
    skillMap.set(skill.name, skill)
  }
  for (const skill of discoveredSkills) {
    if (!skillMap.has(skill.name)) {
      skillMap.set(skill.name, skill)
    }
  }
  const allSkills = Array.from(skillMap.values())

  // [STEP-9] STRATEGY 3: COMPRESS — Load history with compaction
  log.info(`[context-compiler] [STEP-9] Loading conversation history...`)
  let recentMessages: Awaited<ReturnType<typeof getRecentMessages>> = []
  try {
    recentMessages = await getRecentMessages(threadId, KEEP_LAST_N_MESSAGES)
    log.info(`[context-compiler] [STEP-9] ✅ Loaded ${recentMessages.length} recent messages`)
  } catch (err) {
    log.error(`[context-compiler] [STEP-9] ❌ FAILED loading history: ${JSON.stringify(err)}`)
    throw err
  }

  // Check if we need to use summary (conversation is long)
  let summary: Awaited<ReturnType<typeof getSummary>> = null
  try {
    summary = await getSummary(threadId)
  } catch (err) {
    log.error(`[context-compiler] [STEP-9b] ❌ FAILED loading summary: ${JSON.stringify(err)}`)
    throw err
  }

  // A summary applies when it covers messages that fell out of the current
  // window — i.e. the window's earliest message is strictly after the last
  // message the summary covers. (Comparing window tokens against a
  // context-window-sized threshold, as before, almost never fires: the
  // window is capped at KEEP_LAST_N_MESSAGES messages, which rarely
  // approaches 80% of the context window on its own — so the summary was
  // computed, stored, and the user notified, but never actually reached the
  // model.)
  const summaryApplies = !!(
    summary && summary.last_message_id > 0 &&
    (recentMessages.length === 0 || recentMessages[0].id > summary.last_message_id)
  )

  const conversationSummarySection = summaryApplies
    ? `\n\n# RESUMEN DE LA CONVERSACIÓN (turnos anteriores, compactados)\n${summary!.summary.slice(0, SUMMARY_MAX_CHARS)}\n`
    : ""

  if (summaryApplies) {
    log.info(`[context-compiler] [STEP-9c] Summary applies (${summary!.messages_covered} messages compressed) — folded into system prompt`)
  }

  // Never a second "system" turn here — every provider (Gemini, Anthropic,
  // OpenAI-compat) hoists ALL role:"system" messages into a single top-level
  // system instruction, so a second one either gets silently merged (fine)
  // or — on a context-overflow retry that keeps only the LAST system message
  // (openai-compat-base.ts) — silently replaces the real prompt. The summary
  // lives in `systemPrompt` instead (see conversationSummarySection below).
  const messages: LLMMessage[] = toAPIMessages(recentMessages)

  // [STEP-10] STRATEGY 4: ISOLATE — Build context based on agent role
  log.info(`[context-compiler] [STEP-10] Building system prompt...`)
  let systemPrompt: string
  try {
    systemPrompt = await buildSystemPromptWithProjects({ agentId, userId })
    log.info(`[context-compiler] [STEP-10] ✅ System prompt built (${systemPrompt.length} chars)`)
  } catch (err) {
    log.error(`[context-compiler] [STEP-10] ❌ FAILED building system prompt: ${JSON.stringify(err)}`)
    throw err
  }

  // [STEP-10b] Inject current date/time (ENTORNO ACTUAL)
  const usersCol = await col<import("../storage/collections").UserDoc>("users")
  const userRow = await usersCol.get(userId)
  const userTimezone = userRow?.doc.timezone || "UTC"
  const now = new Date()
  const fecha = getUserDate(userTimezone, now)
  const hora = getUserTime(userTimezone, now)
  const workspaceLine = agent.workspace ? `\n**Workspace**: ${agent.workspace} (usa SIEMPRE este path como basePath en herramientas de filesystem)` : ""
  systemPrompt += `\n\n# ENTORNO ACTUAL\n**Fecha**: ${fecha}\n**Hora**: ${hora}\n**Zona horaria**: ${userTimezone}${workspaceLine}\n`
  log.info(`[context-compiler] [STEP-10b] ✅ Injected current date/time: ${fecha} ${hora} (${userTimezone})`)

  // Placed early (right after ENTORNO ACTUAL), not appended at the end: the
  // truncation guard below cuts the system prompt's TAIL when it's over
  // budget, so a summary appended last would be the first thing silently
  // dropped on an oversized prompt.
  systemPrompt += conversationSummarySection

  // Only the live roster goes here — how to delegate, fan-out/fan-in and the
  // execution-truth rules are static doctrine and live in the coordinator's
  // stored prompt (storage/onboarding.ts), not duplicated per turn.
  if (!isWorker) {
    const routingCatalog = renderAgentRoutingCatalog(await listCatalogAgents())
    systemPrompt += `\n\n# COLMENA DE AGENTES\nWorkers disponibles ahora mismo (globales del sistema, ya existen):\n\n${routingCatalog}\n`
  }

  const playbookInput = taskContext || userMessage
  const playbookText = typeof playbookInput === "string"
    ? playbookInput
    : Array.isArray(playbookInput)
      ? playbookInput.filter((part) => part.type === "text").map((part) => (part as any).text).join("\n")
      : String(playbookInput)
  const playbookRules = (await selectPlaybookRules(playbookText)).filter((rule) => {
    if (!rule.applicable_to || !rule.applicable_to.includes("agent:")) return true
    return isCatalogAgent ? rule.applicable_to.includes(`agent:${agent.id}`) : false
  })
  if (playbookRules.length > 0) {
    systemPrompt += `\n\n# PLAYBOOK APRENDIDO\n${playbookRules.map((rule) => `- ${rule.rule}`).join("\n")}\n`
  }

  // Inject scratchpad (Strategy: WRITE) — usando TOON para ahorro de tokens
  if (scratchpadNotes.length > 0) {
    const scratchpadData: Record<string, string> = {}
    for (const n of scratchpadNotes) {
      scratchpadData[n.key] = n.value
    }
    // TOON comprime el formato clave-valor
    const scratchpadContent = formatContext(scratchpadData)
    systemPrompt += `\n\n# SCRATCHPAD (Persistent Notes)\n${scratchpadContent}\n`
  }

  // G9: causal context window (buildAgentContext) — only when the summary
  // applies this turn (a real DB round-trip, not a per-turn cost) and
  // there's a causal stream to build it from. episodicSimilarity is omitted:
  // it requires embeddings hive doesn't generate anywhere yet.
  if (summaryApplies && opts.causalStreamId && loadConfig().causalLog?.enabled) {
    try {
      const causalDb = await getHiveDb()
      const objectiveSource = taskContext || userMessage
      const currentObjective = typeof objectiveSource === "string"
        ? objectiveSource
        : Array.isArray(objectiveSource)
          ? objectiveSource.filter((p) => p.type === "text").map((p) => (p as any).text).join("\n")
          : String(objectiveSource)
      const causalMaxTokens = Math.max(500, Math.min(4000, Math.floor(modelContextWindow * 0.05)))

      const causalCtx = (await causalDb.buildAgentContext({
        taskId: opts.causalStreamId,
        currentPhase: "current",
        currentObjective: currentObjective.slice(0, 2000),
        maxTokens: causalMaxTokens,
        strategy: { causalAnchors: true, compressCompletedPhases: true },
      })) as AgentContextShape

      const causalLines = [...(causalCtx.items ?? []), ...(causalCtx.anomalies ?? [])]
        .map(formatCausalContextItem)
        .filter((line): line is string => !!line)

      if (causalLines.length > 0) {
        systemPrompt += `\n\n# CAUSAL CONTEXT (decisiones y tool calls de este turno, previos a la compactación — priorizá la conversación actual; usalo solo para no repetir algo que ya funcionó o ya falló)\n${causalLines.join("\n")}\n`
        log.info(`[context-compiler] [STEP-9d] ✅ Injected ${causalLines.length} causal context item(s)`)
      }
    } catch (err) {
      log.warn(`[context-compiler] [STEP-9d] ⚠️ Causal context build failed: ${(err as Error).message}`)
    }
  }

  // Coordinator only. Just the live loadout — how to use it is doctrine and
  // lives in the stored prompt + the capability_discovery skill.
  if (!isWorker) {
    const minimalToolsDocs = filteredNativeTools
      .filter(t => MINIMAL_TOOLS.has(t.name))
      .map(t => `- **${t.name}**: ${t.description || "Herramienta nativa"}`)
      .join("\n")

    systemPrompt += `\n\n# HERRAMIENTAS SIEMPRE DISPONIBLES\n${minimalToolsDocs}\n`


    // Inject available skills (minimal + discovered)
    if (allSkills.length > 0) {
      // Minimal skills: inject full body (always-loaded instructions)
      const minimalNames = new Set(minimalSkills.map(s => s.name))
      const minimalWithBody = allSkills.filter(s => minimalNames.has(s.name) && s.body)
      if (minimalWithBody.length > 0) {
        let minimalSection = `\n\n# SKILLS SIEMPRE ACTIVAS\n`
        for (const skill of minimalWithBody) {
          minimalSection += `\n## ${skill.name}\n${skill.body}\n`
        }
        systemPrompt += minimalSection
      }

      // Discovered skills: list only (body arrives via agent-loop when tools are injected)
      const discoveredOnly = allSkills.filter(s => !minimalNames.has(s.name))
      if (discoveredOnly.length > 0) {
        let discoveredSection = `\n\n# SKILLS DESCUBIERTAS (relevantes para esta tarea)\n`
        for (const skill of discoveredOnly) {
          const desc = skill.description ? ` — ${skill.description}` : ""
          discoveredSection += `- **${skill.name}**${desc}\n`
        }
        systemPrompt += discoveredSection
      }

      log.info(`[context-compiler] [STEP-10d] Injected ${minimalWithBody.length} minimal skill bodies + ${discoveredOnly.length} discovered skills`)
    }

  }

  // For isolated workers, add task context + tool discovery instruction
  if (isWorker && opts.taskContext && !isCatalogAgent) {
    systemPrompt += `\n\n# HERRAMIENTAS DISPONIBLES\n` +
      `Arrancas con herramientas básicas. Si tu tarea requiere herramientas adicionales (web_search, fs_read, browser_navigate, etc.):\n` +
      `1. Usá \`search_knowledge(type="tools", query="<herramienta o tarea>")\` para encontrarlas.\n` +
      `2. Las herramientas que encuentres estarán disponibles para usar inmediatamente.\n` +
      `Si el coordinador te indicó herramientas específicas, buscalas primero con search_knowledge antes de ejecutar tu tarea.\n` +
      `\n# CURRENT TASK\n${opts.taskContext}\n\nFocus ONLY on this task. Do not deviate.`
  } else if (isWorker && opts.taskContext) {
    systemPrompt += `\n\n# CURRENT TASK\n${opts.taskContext}\n\nFocus ONLY on this task and return the required structured delivery.`
  }

  // Truncate system prompt only when it exceeds a model-aware budget.
  const maxSystemPromptChars = Math.min(
    MAX_SYSTEM_PROMPT_CHARS_CAP,
    Math.max(8000, Math.floor(modelContextWindow * COMPACT_RATIO * 4))
  )
  if (systemPrompt.length > maxSystemPromptChars) {
    const originalLen = systemPrompt.length
    systemPrompt = systemPrompt.substring(0, maxSystemPromptChars) +
      `\n\n[... System prompt truncated (${originalLen} chars → ${maxSystemPromptChars} chars) ...]`
    log.info(`[context-compiler] System prompt truncated: ${originalLen} → ${maxSystemPromptChars} chars`)
  }

  const estimatedSystemTokens = estimateTokens(systemPrompt)
  const estimatedMsgTokens = messages.reduce((sum, m) => sum + estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)), 0)
  const estimatedToolTokens = toolsForLLM.reduce((sum, t) => sum + estimateTokens(JSON.stringify(t)), 0)
  const estimatedTotal = estimatedSystemTokens + estimatedMsgTokens + estimatedToolTokens
  const budgetPct = modelContextWindow > 0 ? Math.round((estimatedTotal / modelContextWindow) * 100) : 0

  log.info(
    `[context-compiler] ✅ DONE: ${allTools.length} total tools, ` +
    `${toolsForLLM.length} selected tools, ${messages.length} messages, ` +
    `${allSkills.length} skills, isolated=${isWorker}, ` +
    `est.tokens: sys=${estimatedSystemTokens} msgs=${estimatedMsgTokens} tools=${estimatedToolTokens} ` +
    `total=${estimatedTotal}/${modelContextWindow} (${budgetPct}%)`
  )

  return {
    systemPrompt,
    conversationSummarySection,
    messages,
    tools: toolsForLLM,
    allTools,
    skills: allSkills,
  }
}

// Re-export sync functions for gateway/initializer
export {
  syncToolCatalogToIndex as syncToolsToIndex,
  syncSkillsToIndex,
  syncPlaybookToIndex,
}
