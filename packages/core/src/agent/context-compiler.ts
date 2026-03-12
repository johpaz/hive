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
import type { LLMMessage, LLMToolDef } from "./llm-client"
import type { MCPClientManager } from "@johpaz/hive-mcp"
import { syncToolCatalogToFTS, mcpToolFullName } from "./tool-selector"
import { syncSkillsToFTS } from "./skill-selector"
import { syncPlaybookToFTS } from "./playbook-selector"
import { getRecentMessages, getSummary, getScratchpad, toAPIMessages } from "./conversation-store"
import { formatContext, estimateTokens } from "../utils/toon"
import { buildSystemPromptWithProjects } from "./prompt-builder"
import { createAllTools } from "../tools/index.ts"
import { resolveUserId } from "../storage/onboarding"
import { getMCPManager as getSingletonMCPManager } from "../mcp/singleton"
import { getUserDate, getUserTime } from "../utils/date"

const log = logger.child("context-compiler")

// Configuration constants
const KEEP_LAST_N_MESSAGES = 40      // Always keep last N messages (Strategy: SELECT) — increased because tool calls/results are now persisted
const TOKEN_COMPACT_THRESHOLD = 6000 // Compact when exceeds this (Strategy: COMPRESS)

// MINIMAL TOOL SET — fixed always-available tools
// The agent discovers the rest via search_knowledge
const MINIMAL_TOOLS = new Set([
  "save_note",
  "notify",
  "report_progress",
  "search_knowledge",
])

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
  userMessage: string
  channel?: string
  isolated?: boolean
  taskContext?: string
  mcpManager?: MCPClientManager | null
}): Promise<CompiledContext> {
  const db = getDb()
  const { agentId, threadId, mcpManager, userMessage, isolated } = opts

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

            // Executor for agent-loop (has the real call)
            mcpToolExecutors.push({
              name: fullName,
              description: mcpTool.description || `Tool from ${server.name}`,
              parameters: mcpTool.inputSchema || { type: "object", properties: {} },
              execute: async (params: Record<string, unknown>) => {
                const result = await effectiveMcpManager.callTool(server.id, mcpTool.name, params)
                return typeof result === "string" ? result : JSON.stringify(result)
              },
            })

          }
        } else {
          log.warn(`[context-compiler] [STEP-3c] Server ${server.name} has no tools (not connected yet)`)
        }
      }

      log.info(`[context-compiler] [STEP-3c] ✅ Loaded ${mcpToolExecutors.length} MCP tools`)
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

  // Filter to minimal tool set for NATIVE tools only
  // MCP tools are ALWAYS included directly (no search needed)
  const filteredNativeTools: ContextTool[] = nativeTools.filter(t => MINIMAL_TOOLS.has(t.name))
  
  // MCP tools: include ALL of them directly (user configured, always available)
  const mcpToolsForLLM: LLMToolDef[] = mcpToolExecutors.map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
  
  // Native minimal tools
  const nativeToolsForLLM: LLMToolDef[] = filteredNativeTools.map(t => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
  
  // Combine: native minimal + ALL MCP tools
  const toolsForLLM: LLMToolDef[] = [...nativeToolsForLLM, ...mcpToolsForLLM]
  
  log.info(`[context-compiler] [STEP-4] Minimal native tool set: ${filteredNativeTools.length} tools`)
  log.info(`[context-compiler] [STEP-4b] MCP tools (direct): ${mcpToolsForLLM.length} tools`)
  log.info(`[context-compiler] [STEP-8] ✅ Combined tools: ${allTools.length} total, ${toolsForLLM.length} selected`)

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

  if (summary && totalTokens > TOKEN_COMPACT_THRESHOLD) {
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
  systemPrompt += `\n\n# ENTORNO ACTUAL\n**Fecha**: ${fecha}\n**Hora**: ${hora}\n**Zona horaria**: ${userTimezone}\n`
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

  // Inject active/recent project state from DB (coordinator only)
  if (!isWorker) {
    try {
      const recentProjects = db.query<any, []>(`
        SELECT p.id, p.name, p.status, p.progress, p.description,
               COUNT(t.id) as total_tasks,
               SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as done_tasks
        FROM projects p
        LEFT JOIN tasks t ON t.project_id = p.id
        WHERE p.status IN ('active', 'pending', 'paused')
        GROUP BY p.id
        ORDER BY p.updated_at DESC
        LIMIT 10
      `).all()

      if (recentProjects.length > 0) {
        let projectSection = `\n\n# ESTADO DE PROYECTOS\n`
        for (const proj of recentProjects) {
          projectSection += `\n## ${proj.name} [${proj.status.toUpperCase()}] (${proj.done_tasks}/${proj.total_tasks} tareas, ${proj.progress ?? 0}%)\n`
          if (proj.description) projectSection += `> ${proj.description}\n`

          // Load tasks for this project
          const tasks = db.query<any, [string]>(
            "SELECT name, status, progress, result FROM tasks WHERE project_id = ? ORDER BY id ASC"
          ).all(proj.id)
          for (const task of tasks) {
            const resultSummary = task.result
              ? ` → ${task.result.substring(0, 120)}${task.result.length > 120 ? "…" : ""}`
              : ""
            projectSection += `  - [${task.status}] ${task.name}${resultSummary}\n`
          }
        }
        systemPrompt += projectSection
        log.info(`[context-compiler] [STEP-10c] Injected ${recentProjects.length} projects into context`)
      }
    } catch (err) {
      log.warn(`[context-compiler] [STEP-10c] Failed to inject projects: ${(err as Error).message}`)
    }
  }

  // Dynamic tool discovery instruction (coordinator only)
  // Note: MCP tools are already available directly, no search needed
  if (!isWorker) {
    systemPrompt += `\n\n# CATÁLOGO DE HERRAMIENTAS\n` +
      `Tienes herramientas nativas y MCP directamente disponibles.\n` +
      `Usá \`search_knowledge\` solo para:\n` +
      `- Skills (instrucciones de tareas complejas): type="skills"\n` +
      `- Playbook (buenas prácticas): type="playbook"\n` +
      `- Herramientas nativas específicas: type="tools"\n` +
      `Las herramientas MCP ya están disponibles - no necesitas buscarlas.\n`
  }

  // For isolated workers, add task context
  if (isWorker && opts.taskContext) {
    systemPrompt += `\n\n# CURRENT TASK\n${opts.taskContext}\n\nFocus ONLY on this task. Do not deviate.`
  }

  log.info(
    `[context-compiler] ✅ DONE: ${allTools.length} total, ` +
    `${toolsForLLM.length} selected tools, ${messages.length} messages, ` +
    `isolated=${isWorker}`
  )

  return {
    systemPrompt,
    messages,
    tools: toolsForLLM,
    allTools,
  }
}

// Re-export sync functions for gateway/initializer
export {
  syncToolCatalogToFTS as syncToolsToFTS,
  syncSkillsToFTS,
  syncPlaybookToFTS,
}
