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

import { getDb } from "../storage/sqlite"
import { logger } from "../utils/logger"
import type { LLMMessage, LLMToolDef, ContentPart } from "./llm-client"
import type { MCPClientManager } from "@johpaz/hive-agents-mcp"
import { syncToolCatalogToFTS, mcpToolFullName } from "./tool-selector"
import { syncSkillsToFTS, getMinimalSkills, selectSkills, type SkillDescriptor } from "./skill-selector"
import { syncPlaybookToFTS } from "./playbook-selector"
import { getRecentMessages, getSummary, getScratchpad, toAPIMessages } from "./conversation-store"
import { formatContext, estimateTokens } from "../utils/toon"
import { buildSystemPromptWithProjects } from "./prompt-builder"
import { createAllTools } from "../tools/index.ts"
import { resolveUserId } from "../storage/onboarding"
import { getMCPManager as getSingletonMCPManager } from "../mcp/singleton"
import { syncMCPToolsToDB, syncMCPToolsToFTS } from "../mcp/tool-sync"
import { getUserDate, getUserTime } from "../utils/date"

const log = logger.child("context-compiler")

// Configuration constants
const KEEP_LAST_N_MESSAGES = 30      // Always keep last N messages (Strategy: SELECT) — only user+assistant text, no tool results
const DEFAULT_CONTEXT_WINDOW = 250000 // Default context window when model is unknown
const COMPACT_RATIO = 0.80           // Compact when estimated input exceeds 70% of context window
const MAX_SYSTEM_PROMPT_CHARS_CAP = 128000 // Hard cap for pathological prompts; normal budget is model-aware

// MINIMAL TOOL SET — fixed always-available tools
// The agent discovers the rest via search_knowledge
const MINIMAL_TOOLS = new Set([
  "save_note",
  "notify",
  "report_progress",
  "search_knowledge",
])

// MINIMAL SKILL SET — fixed always-available skills
// These skills are ALWAYS in context - the agent uses them to discover everything else
const MINIMAL_SKILL_NAMES = [
  "busqueda_fts5",    // Core: how to find tools, skills, MCP, playbook via search_knowledge
  "memory_manager",   // Persistent notes that survive context compression
  "canvas_report",    // Display results to users with charts, tables, cards
  "task_orchestrator", // Agent coordination via notify
]

// ─── Types ─────────────────────────────────────────────────────────────────

// Simple tool interface for context compilation
export interface ContextTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute?: (params: Record<string, unknown>) => Promise<unknown>
}

export interface CompiledContext {
  systemPrompt: string
  messages: LLMMessage[]
  tools: LLMToolDef[]
  allTools: ContextTool[]
  skills: SkillDescriptor[]  // Skills loaded (minimal + discovered)
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
}): Promise<CompiledContext> {
  const db = getDb()
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
  const userId = opts.userId || resolveUserId({
    threadId,
    channel: opts.channel,
    channelUserId: threadId
  }) || threadId || ""

  // [STEP-1] Load agent config
  log.info(`[context-compiler] [STEP-1] Loading agent config for id=${agentId}`)
  let agent: any
  try {
    agent = db.query<any, [string]>(
      "SELECT * FROM agents WHERE id = ?"
    ).get(agentId)
  } catch (err) {
    log.error(`[context-compiler] [STEP-1] ❌ FAILED loading agent: ${JSON.stringify(err)}`)
    throw err
  }

  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`)
  }

  const isWorker = agent.role === 'worker' || !!isolated
  log.info(`[context-compiler] [STEP-1] ✅ Compiling for ${isWorker ? 'worker' : 'coordinator'} agent=${agent.name}`)

  // Load model's context window for compaction decisions
  let modelContextWindow = DEFAULT_CONTEXT_WINDOW
  if (agent.model_id) {
    try {
      const mRow = db.query<any, [string]>("SELECT context_window FROM models WHERE id = ?").get(agent.model_id.replace(/^[^/]+\//, ''))
      if (mRow?.context_window) modelContextWindow = mRow.context_window
    } catch { /* use default */ }
  }

  // [STEP-2] STRATEGY 1: WRITE — Load scratchpad (persistent notes)
  log.info(`[context-compiler] [STEP-2] Loading scratchpad...`)
  let scratchpadNotes: ReturnType<typeof getScratchpad> = []
  try {
    scratchpadNotes = getScratchpad(threadId)
    log.info(`[context-compiler] [STEP-2] ✅ Loaded ${scratchpadNotes.length} scratchpad notes`)
  } catch (err) {
    log.error(`[context-compiler] [STEP-2] ❌ FAILED loading scratchpad: ${JSON.stringify(err)}`)
    throw err
  }

  // [STEP-3c] Load MCP tools (executors only — FTS sync happens here too)
  log.info(`[context-compiler] [STEP-3c] Loading MCP tools...`)
  const mcpToolExecutors: ContextTool[] = []

  if (effectiveMcpManager) {
    try {
      const dbServers = db.query<any, []>(
        "SELECT id, name, status FROM mcp_servers WHERE enabled = 1"
      ).all()

      for (const server of dbServers) {
        // Try ID first (normalized), then name
        let serverTools = effectiveMcpManager.getServerTools(server.id)
        if (!serverTools || serverTools.length === 0) {
          serverTools = effectiveMcpManager.getServerTools(server.name)
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
                return await effectiveMcpManager.callTool(server.id, mcpTool.name, params)
              },
            })

          }
        } else {
          log.warn(`[context-compiler] [STEP-3c] Server ${server.name} has no tools (not connected yet)`)
        }
      }

      log.info(`[context-compiler] [STEP-3c] ✅ Loaded ${mcpToolExecutors.length} MCP tools`)

      // Persist MCP tool definitions to DB for search_knowledge and FTS5 search
      if (mcpToolExecutors.length > 0) {
        try {
          for (const server of dbServers) {
            let serverTools = effectiveMcpManager!.getServerTools(server.id)
            if (!serverTools || serverTools.length === 0) {
              serverTools = effectiveMcpManager!.getServerTools(server.name)
            }
            if (serverTools && serverTools.length > 0) {
              syncMCPToolsToDB(server.id || server.name, server.name, serverTools)
            }
          }
          await syncMCPToolsToFTS();
          log.info(`[context-compiler] [STEP-3c] ✅ Persisted MCP tools to DB + FTS5`)
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
  }))

  const allTools = [...nativeTools, ...mcpToolExecutors]

  // Only native minimal tools in LLM context
  // MCP tools are discovered dynamically via search_knowledge(type="mcp")
  const filteredNativeTools: ContextTool[] = nativeTools.filter(t => MINIMAL_TOOLS.has(t.name))

  const nativeToolsForLLM: LLMToolDef[] = filteredNativeTools.map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))

  const toolsForLLM: LLMToolDef[] = nativeToolsForLLM

  log.info(`[context-compiler] [STEP-4] Minimal native tool set: ${filteredNativeTools.length} tools`)
  log.info(`[context-compiler] [STEP-4b] MCP tools available via search_knowledge: ${mcpToolExecutors.length} (not injected)`)
  log.info(`[context-compiler] [STEP-8] ✅ Combined tools: ${allTools.length} total executors, ${toolsForLLM.length} in LLM context`)

  // [STEP-8b] STRATEGY 2: SELECT — Skill Loadout (minimal + discovered)
  log.info(`[context-compiler] [STEP-8b] Building skill loadout...`)
  let minimalSkills: SkillDescriptor[] = []
  let discoveredSkills: SkillDescriptor[] = []

  try {
    // Load minimal skills (always available)
    minimalSkills = getMinimalSkills()
    log.info(`[context-compiler] [STEP-8b] ✅ Loaded ${minimalSkills.length} minimal skills`)

    // Discover additional skills via FTS5 (coordinator only)
    if (!isWorker) {
      const inputForSkills = taskContext || userMessage
      const textMessage = typeof inputForSkills === "string"
        ? inputForSkills
        : Array.isArray(inputForSkills)
          ? inputForSkills.filter(p => p.type === "text").map(p => (p as any).text).join("\n")
          : String(inputForSkills)
      discoveredSkills = selectSkills(textMessage)
      log.info(`[context-compiler] [STEP-8b] ✅ Discovered ${discoveredSkills.length} additional skills via FTS5`)
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
  let recentMessages: ReturnType<typeof getRecentMessages> = []
  try {
    recentMessages = getRecentMessages(threadId, KEEP_LAST_N_MESSAGES)
    log.info(`[context-compiler] [STEP-9] ✅ Loaded ${recentMessages.length} recent messages`)
  } catch (err) {
    log.error(`[context-compiler] [STEP-9] ❌ FAILED loading history: ${JSON.stringify(err)}`)
    throw err
  }

  // Check if we need to use summary (conversation is long)
  let summary: ReturnType<typeof getSummary> = null
  try {
    summary = getSummary(threadId)
  } catch (err) {
    log.error(`[context-compiler] [STEP-9b] ❌ FAILED loading summary: ${JSON.stringify(err)}`)
    throw err
  }

  const totalTokens = recentMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0)

  let messages: LLMMessage[]

  const compactThreshold = Math.floor(modelContextWindow * COMPACT_RATIO)
  if (summary && totalTokens > compactThreshold) {
    // Use summary + recent messages (Strategy: COMPRESS)
    messages = [
      { role: "system", content: `[Conversation Summary]: ${summary.summary}` },
      ...toAPIMessages(recentMessages),
    ]
    log.info(`[context-compiler] [STEP-9c] Using summary (${summary.messages_covered} messages compressed)`)
  } else {
    // Conversation is short enough, use all recent messages
    messages = toAPIMessages(recentMessages)
  }

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
  const userRow = db.query<any, [string]>(
    "SELECT timezone FROM users WHERE id = ?"
  ).get(userId)
  const userTimezone = userRow?.timezone || "UTC"
  const now = new Date()
  const fecha = getUserDate(userTimezone, now)
  const hora = getUserTime(userTimezone, now)
  const workspaceLine = agent.workspace ? `\n**Workspace**: ${agent.workspace} (usa SIEMPRE este path como basePath en herramientas de filesystem)` : ""
  systemPrompt += `\n\n# ENTORNO ACTUAL\n**Fecha**: ${fecha}\n**Hora**: ${hora}\n**Zona horaria**: ${userTimezone}${workspaceLine}\n`
  log.info(`[context-compiler] [STEP-10b] ✅ Injected current date/time: ${fecha} ${hora} (${userTimezone})`)

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

  // Dynamic tool discovery instruction (coordinator only)
  // Note: MCP tools are already available directly, no search needed
  if (!isWorker) {
    // Build minimal tools documentation from filtered native tools
    const minimalToolsDocs = filteredNativeTools
      .filter(t => MINIMAL_TOOLS.has(t.name))
      .map(t => `- **${t.name}**: ${t.description || "Herramienta nativa"}`)
      .join("\n")

    systemPrompt += `\n\n# HERRAMIENTAS SIEMPRE DISPONIBLES\n` +
      `${minimalToolsDocs}\n\n` +
      `## Delegación a workers\n` +
      `Los workers arrancan con estas mismas 4 herramientas mínimas.\n` +
      `**Antes de delegar**, usá \`search_knowledge(type="tools", query="<tarea>")\` para identificar qué tools necesita el worker e incluirlas en la instrucción de \`task_delegate\`.\n`


    // Inject available skills (minimal + discovered)
    if (allSkills.length > 0) {
      // Minimal skills: inject full body (always-loaded instructions)
      const minimalWithBody = allSkills.filter(s => MINIMAL_SKILL_NAMES.includes(s.name) && s.body)
      if (minimalWithBody.length > 0) {
        let minimalSection = `\n\n# SKILLS SIEMPRE ACTIVAS\n`
        for (const skill of minimalWithBody) {
          minimalSection += `\n## ${skill.name}\n${skill.body}\n`
        }
        systemPrompt += minimalSection
      }

      // Discovered skills: list only (body arrives via agent-loop when tools are injected)
      const discoveredOnly = allSkills.filter(s => !MINIMAL_SKILL_NAMES.includes(s.name))
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
  if (isWorker && opts.taskContext) {
    systemPrompt += `\n\n# HERRAMIENTAS DISPONIBLES\n` +
      `Arrancas con herramientas básicas. Si tu tarea requiere herramientas adicionales (web_search, fs_read, browser_navigate, etc.):\n` +
      `1. Usá \`search_knowledge(type="tools", query="<herramienta o tarea>")\` para encontrarlas.\n` +
      `2. Las herramientas que encuentres estarán disponibles para usar inmediatamente.\n` +
      `Si el coordinador te indicó herramientas específicas, buscalas primero con search_knowledge antes de ejecutar tu tarea.\n` +
      `\n# CURRENT TASK\n${opts.taskContext}\n\nFocus ONLY on this task. Do not deviate.`
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
    messages,
    tools: toolsForLLM,
    allTools,
    skills: allSkills,
  }
}

// Re-export sync functions for gateway/initializer
export {
  syncToolCatalogToFTS as syncToolsToFTS,
  syncSkillsToFTS,
  syncPlaybookToFTS,
}
