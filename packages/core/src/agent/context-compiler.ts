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

// MINIMAL SKILL SET — fixed always-available skills
// These skills are ALWAYS in context - the agent uses them to discover everything else
const MINIMAL_SKILL_NAMES = [
  "busqueda_fts5",   // Core: how to find tools, skills, MCP, playbook via search_knowledge
  "canvas_report",  // Display results to users with charts, tables, cards
  "memory_manager", // Persistent notes that survive context compression
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
    // Build minimal tools documentation from filtered native tools
    const minimalToolsDocs = filteredNativeTools
      .filter(t => MINIMAL_TOOLS.has(t.name))
      .map(t => `- **${t.name}**: ${t.description || "Herramienta nativa"}`)
      .join("\n")

    systemPrompt += `\n\n# HERRAMIENTAS NATIVAS BÁSICAS (SIEMPRE DISPONIBLES)\n` +
      `Estas 4 herramientas nativas están SIEMPRE disponibles en tu contexto y tienen prioridad sobre MCP:\n\n` +
      `${minimalToolsDocs}\n\n` +
      `**REGLAS DE USO:**\n` +
      `1. Si necesitas una herramienta que no esté en la lista arriba → USA \`search_knowledge\` para encontrarla:\n` +
      `   - Herramientas nativas: \`search_knowledge(type="tools", query="<qué necesitas>")\`\n` +
      `   - Herramientas MCP (externas): \`search_knowledge(type="mcp", query="<qué necesitas>")\`\n` +
      `   - Todo junto: \`search_knowledge(type="all", query="<qué necesitas>")\`\n` +
      `2. NUNCA uses una herramienta MCP si existe una nativa equivalente en el catálogo\n` +
      `3. Las herramientas MCP se activan dinámicamente vía search_knowledge — NO están en tu contexto por defecto\n\n` +
      `# CATÁLOGO DE HERRAMIENTAS\n` +
      `Usá \`search_knowledge\` para descubrir:\n` +
      `- Skills (instrucciones de tareas complejas): type="skills"\n` +
      `- Playbook (buenas prácticas): type="playbook"\n` +
      `- Herramientas nativas: type="tools"\n` +
      `- Herramientas MCP (externas): type="mcp"\n` +
      `- Todo: type="all"\n` +
      `\n## REGLA CRÍTICA — Delegación a workers\n` +
      `Los workers arrancan con herramientas mínimas (save_note, notify, report_progress, search_knowledge).\n` +
      `**ANTES de crear o delegar a un worker**, SIEMPRE debes:\n` +
      `1. Usar \`search_knowledge(type="tools", query="<tarea del worker>")\` para identificar qué herramientas necesita.\n` +
      `2. Incluir esas herramientas en el campo \`tools\` al crear el agente con \`create_agent\`, o\n` +
      `   en el campo \`task_description\` de \`task_delegate\` como instrucción explícita:\n` +
      `   "Usa las herramientas: web_search, fs_read, ... para completar esta tarea."\n` +
      `3. El worker con esa instrucción usará \`search_knowledge\` para activar las tools por nombre.\n` +
      `Ejemplo: si el worker debe investigar en internet → busca "web search herramienta internet, herramientas de navegacion, browser" → obtienes "web_search" → dile al worker que use web_search.\n` +
      `4. Las herramientas se inyectan dinamicamente vía search_knowledge — NO están en tu contexto por defecto\n`


    // Inject available skills (minimal + discovered)
    if (allSkills.length > 0) {
      let skillsSection = `\n\n# SKILLS ACTIVAS\n`
      skillsSection += `Usá estas skills como guía cuando sea relevante:\n\n`

      for (const skill of allSkills) {
        const isMinimal = MINIMAL_SKILL_NAMES.includes(skill.name)
        const badge = isMinimal ? "[SIEMPRE]" : "[DISCOVERED]"
        const desc = skill.description ? ` — ${skill.description}` : ""
        skillsSection += `- **${skill.name}** ${badge}${desc}\n`
      }

      systemPrompt += skillsSection
      log.info(`[context-compiler] [STEP-10d] Injected ${allSkills.length} skills (${minimalSkills.length} minimal, ${discoveredSkills.length} discovered)`)
    }

    // Inject Canvas A2UI component documentation
    systemPrompt += `\n\n# 🎨 CANVAS A2UI — Componentes disponibles para \`canvas_render\`\n` +
      `**REGLA**: Usá \`canvas_render\` con el tipo específico en vez de siempre usar \`canvas_show_card\` + markdown.\n\n` +
      `## Tipos de visualización:\n` +
      `- **chart** — Gráficos. Props: \`{type:"bar"|"line"|"area"|"pie", data:[{name,...}], xKey:"name", keys:["valor"], colors:[], title}\`\n` +
      `- **table** — Tablas de datos. Props: \`{title, columns:[{header,key}], data:[{...}]}\`\n` +
      `- **progress** — Barras de progreso. Props: \`{bars:[{label,value:0-100}]}\`\n` +
      `- **markdown** — Texto rich. Props: \`{content:"## título\\n..."}\`\n` +
      `- **card** — Tarjeta con items. Props: \`{title, description, items:[{label,value}], footer}\`\n` +
      `- **accordion** — Secciones colapsables. Props: \`{items:[{value,title,content}]}\`\n` +
      `- **tabs** — Pestañas. Props: \`{tabs:[{value,label,content}]}\`\n` +
      `- **badge** — Etiqueta. Props: \`{label, variant:"default"|"secondary"|"destructive"|"outline"}\`\n` +
      `- **separator** — Línea divisora\n` +
      `- **bee-loader** — Animación de carga. Props: \`{message}\`\n\n` +
      `## Tipos interactivos (bloquean hasta respuesta del usuario):\n` +
      `- **form** — Formulario. Props: \`{title, fields:[{name,label,type,placeholder,options}], submitLabel}\`\n` +
      `  → Tipos de campo: \`text\`, \`email\`, \`number\`, \`textarea\`, \`select\`, \`checkbox\`\n` +
      `  → Al Submit recibirás: \`{data:{campo:valor,...}}\`\n` +
      `- **button** — Botón clickeable. Props: \`{label, variant:"default"|"outline"|"secondary"|"destructive"}\`\n` +
      `  → Al click recibirás: \`{action:"click", data:{label}}\`\n` +
      `- **alert-dialog** — Confirmación. Props: \`{title, description, confirmLabel, cancelLabel}\`\n` +
      `  → Al confirmar recibirás: \`{data:{confirmed:true|false}}\`\n\n` +
      `## Cuándo usar cada uno:\n` +
      `- Estadísticas/datos numéricos → **chart** (bar/line/pie)\n` +
      `- Listas de filas/columnas → **table**\n` +
      `- Texto largo / análisis → **markdown**\n` +
      `- Pedir datos al usuario → **canvas_ask** o **canvas_render con form**\n` +
      `- Confirmar acción peligrosa → **canvas_confirm** o **canvas_render con alert-dialog**\n` +
      `- Mostrar progreso de tarea → **canvas_show_progress**\n\n` +
      `## Ejemplos:\n` +
      `\`\`\`\n` +
      `canvas_render(component:"chart", data:{type:"bar", data:[{mes:"Ene",ventas:1200},{mes:"Feb",ventas:1800}], xKey:"mes", keys:["ventas"], title:"Ventas por mes"})\n` +
      `canvas_render(component:"table", data:{title:"Archivos", columns:[{header:"Nombre",key:"name"},{header:"Tamaño",key:"size"}], data:[{name:"app.ts",size:"12KB"}]})\n` +
      `canvas_render(component:"form", data:{title:"Configuración", fields:[{name:"nombre",label:"Nombre",type:"text"},{name:"tipo",label:"Tipo",type:"select",options:[{value:"a",label:"A"},{value:"b",label:"B"}]}], submitLabel:"Guardar"})\n` +
      `\`\`\`\n\n` +
      `# 🎨🎨 CANVAS A2UI v0.9 — Superficies interactivas ricas\n` +
      `Además de los componentes shadcn, podes crear superficies A2UI v0.9 (protocolo estándar de Google) para UIs ricas e interactivas.\n\n` +
      `## Flujo A2UI:\n` +
      `1. \`a2ui_create_surface\` — Crear la superficie (obligatorio primero)\n` +
      `2. \`a2ui_update_components\` — Enviar componentes (puedes enviar múltiples veces)\n` +
      `3. \`a2ui_update_data_model\` — Actualizar datos dinámicos\n` +
      `4. \`a2ui_delete_surface\` — Eliminar la superficie\n\n` +
      `## Componentes A2UI v0.9:\n` +
      `- **Column** — Contenedor vertical. Props: children (array de IDs), distribution, alignment\n` +
      `- **Row** — Contenedor horizontal. Props: children (array de IDs), distribution, alignment\n` +
      `- **Card** — Tarjeta con child\n` +
      `- **Text** — Texto con usageHint: h1-h5, body, caption, code, label\n` +
      `- **Button** — Botón interactivo. Props: child, variant ("primary"|"borderless"), action\n` +
      `- **TextField** — Campo de texto. Props: label, value (path), variant, placeholder, checks\n` +
      `- **CheckBox** — Checkbox. Props: label, value (path)\n` +
      `- **ChoicePicker** — Selección múltiple. Props: options, variant, maxAllowedSelections, selections\n` +
      `- **Slider** — Slider numérico. Props: value (path), minValue, maxValue\n` +
      `- **DateTimeInput** — Fecha/hora. Props: value (path), enableDate, enableTime\n` +
      `- **List** — Lista scrolleable. Props: children, direction\n` +
      `- **Tabs** — Pestañas. Props: tabItems\n` +
      `- **Modal** — Diálogo. Props: entryPointChild, contentChild\n` +
      `- **Divider** — Línea divisora. Props: axis\n` +
      `- **Image** — Imagen. Props: url, fit, usageHint\n` +
      `- **Icon** — Ícono. Props: name\n` +
      `- **Video** — Video. Props: url\n` +
      `- **AudioPlayer** — Reproductor de audio. Props: url, description\n\n` +
      `## Data Binding (Dynamic Values):\n` +
      `- Valor literal: \`"texto"\` o número directo\n` +
      `- Path del data model: \`{"path": "/user/name"}\` — se resuelve contra el data model de la superficie\n` +
      `- Function call: \`{"call": "formatDate", "args": {"value": {"path": "/date"}, "format": "yyyy-MM-dd"}}\`\n\n` +
      `## Acciones:\n` +
      `- Evento: \`{"event": {"name": "submit_form", "context": {"email": {"path": "/form/email"}}}}\`\n` +
      `- El contexto se resuelve contra el data model antes de enviar\n\n` +
      `## Ejemplo completo:\n` +
      `\`\`\`\n` +
      `// 1. Crear superficie\n` +
      `a2ui_create_surface(surfaceId:"contact_form", catalogId:"https://a2ui.org/specification/v0_9/basic_catalog.json", theme:{primaryColor:"#3B82F6", agentDisplayName:"Asistente"})\n\n` +
      `// 2. Enviar componentes\n` +
      `a2ui_update_components(surfaceId:"contact_form", components:[\n` +
      `  {id:"root", component:"Column", children:{array:["header","name_field","email_field","submit_btn"]}},\n` +
      `  {id:"header", component:"Text", text:"Contacto", usageHint:"h2"},\n` +
      `  {id:"name_field", component:"TextField", label:"Nombre", value:{path:"/form/name"}, variant:"shortText"},\n` +
      `  {id:"email_field", component:"TextField", label:"Email", value:{path:"/form/email"}, variant:"shortText", checks:[{call:"required",args:{value:{path:"/form/email"}},message:"Email es obligatorio"},{call:"email",args:{value:{path:"/form/email"}},message:"Email inválido"}]},\n` +
      `  {id:"submit_text", component:"Text", text:"Enviar"},\n` +
      `  {id:"submit_btn", component:"Button", child:"submit_text", variant:"primary", action:{event:{name:"submit_contact",context:{name:{path:"/form/name"},email:{path:"/form/email"}}}}}\n` +
      `])\n\n` +
      `// 3. Poblar data model\n` +
      `a2ui_update_data_model(surfaceId:"contact_form", path:"/form", value:{name:"",email:""})\n` +
      `\`\`\`\n`
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

  log.info(
    `[context-compiler] ✅ DONE: ${allTools.length} total tools, ` +
    `${toolsForLLM.length} selected tools, ${messages.length} messages, ` +
    `${allSkills.length} skills (${minimalSkills.length} minimal, ${discoveredSkills.length} discovered), ` +
    `isolated=${isWorker}`
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
