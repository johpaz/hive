/**
 * HiveDB-based Dynamic Tool Selector Module
 *
 * Context Compiler Level 3 - Intelligent Tool Selection
 *
 * This module intercepts each message BEFORE calling the LLM and uses
 * HiveDB BM25 scoring (Spanish stemming + accent folding, per-field boosts)
 * to select the most relevant tools.
 *
 * DESIGN DECISIONS:
 *
 * 1. Stateless: No memory between turns - each message is evaluated independently.
 *    Rationale: Prevents cascade effects where a bad selection in one turn affects
 *    future turns. Forces fresh evaluation each time.
 *
 * 2. Maximum tools per turn: Keeps token count low and prevents overwhelming
 *    the LLM with irrelevant tools. Forces prioritization.
 *
 * 3. Relative relevance cutoff: BM25 scores are positive (higher = better) but
 *    their magnitude depends on corpus and document length, so hits are kept
 *    only if they score at least RELEVANCE_RATIO of the top hit. Conversational
 *    messages are short-circuited by pattern matching before any search.
 *
 * 4. Atomic over orchestration: When ambiguous, prefer individual tools over
 *    compound/manager tools. Rationale: Atomic tools are more predictable and
 *    the LLM can combine them as needed.
 *
 * 5. Performance: Must complete in under 50ms. HiveDB (tantivy) queries are
 *    sub-millisecond for small tool catalogs (<100 tools).
 *
 * 6. Tool categorization: Tools are categorized by semantic domain:
 *    - scheduling (cron tools)
 *    - filesystem (file operations)
 *    - web (search/fetch)
 *    - browser (browser automation)
 *    - memory (notes, memory operations)
 *    - code (exec, terminal)
 *    - a2ui (interactive panel rendering)
 *    - agents (agent creation/management)
 *    - core (notify, report_progress, save_note)
 */

import { col } from "../storage/hive"
import type { ToolDoc } from "../storage/collections"
import { logger } from "../utils/logger"
import {
    searchCapabilities,
    applyRelativeCutoff,
    replaceCapabilityDocs,
    type CapabilityDoc,
} from "./capability-search"
import { isCalendarOperation } from "./routing-intent"

const log = logger.child("tool-selector")

// ─── Types ───────────────────────────────────────────────────────────────────────

export interface ToolDescriptor {
    name: string
    description: string
    category: string
    /** Abstraction level: atomic (single operation) vs orchestration (manages multiple) */
    abstractionLevel?: "atomic" | "orchestration"
}

export interface SelectedTool {
    name: string
    score: number
    category: string
}

export interface ToolSelectorResult {
    tools: ToolDescriptor[]
    selected: SelectedTool[]
    reasoning: string
    timingMs: number
}

// ─── Configuration ───────────────────────────────────────────────────────────

/** Maximum tools to return per message */
const MAX_TOOLS_PER_TURN = 12

/**
 * Relative relevance cutoff: keep a hit only if it scores at least this
 * fraction of the top hit. HiveDB BM25 scores are positive (higher = better)
 * but corpus-dependent, so absolute thresholds don't transfer — a ratio does.
 */
const RELEVANCE_RATIO = 0.3

/** Stopwords to filter out before BM25 query construction */
const STOPWORDS = new Set([
    "que", "con", "para", "por", "una", "uno", "los", "las", "del",
    "como", "esta", "esto", "ese", "eso", "the", "and", "for",
    "with", "this", "that", "have", "will", "also", "de", "en",
    "el", "la", "se", "su", "sus", "al", "es", "son", "pero",
    "más", "mas", "ya", "yo", "tu", "te", "ti", "mi", "me",
    "hola", "hi", "hello", "hey", "gracias", "thank", "please",
    "ok", "okay", "yes", "si", "no", "bien", "good", "great",
])

/** Conversational patterns that should return empty tool list */
const CONVERSATIONAL_PATTERNS = [
    /^(hola|hi|hello|hey|buenos? días?|buenas? noches?|qué tal|howdy)/i,
    /^(gracias|thank you|thanks|muchas gracias|muchas thanks)/i,
    /^(cómo estás?|how are you?|qué流水|you doing|qué cuentas)/i,
    /^(sí|yes|ok|okay|de acuerdo|perfecto|claro|por supuesto)/i,
    /^(adiós|bye|nos vemos|see you|later|chau)/i,
    /^(entiendo|understand|i see|ya veo|got it)/i,
    /^(bien|good|great|excelente|awesome|perfect)/i,
    /^(?:\?|¿)$/,  // Just a question mark
]

// ─── Tool Catalog ───────────────────────────────────────────────────────────
//
// These 47 tools are the core toolset. Each has:
// - name: unique identifier
// - description: what the tool does (used for BM25 matching)
// - category: semantic domain for grouping
// - abstractionLevel: atomic (single operation) vs orchestration (manages multiple)
//
// The descriptions are enriched with Spanish/English keywords for better BM25 matching.

export const CORE_TOOL_CATALOG: ToolDescriptor[] = [
    // Cron tools (cron.*)
    { name: "cron.create", description: "Create a Hive scheduled automation: recurring (cron expression) or one-shot (fire_at). Requires a task instruction. Spanish keywords: programar tarea, crear automatización, ejecutar después, tarea recurrente, recordatorio automático, una vez", category: "scheduling", abstractionLevel: "atomic" },
    { name: "cron.list", description: "List all cron jobs with next execution times and status. Spanish keywords: ver tareas programadas, listar cronograma, próximas ejecuciones, tareas activas, recordatorios pendientes", category: "scheduling", abstractionLevel: "atomic" },
    { name: "cron.update", description: "Update an existing cron job: change expression, task instruction, channel, time window, etc. Use cron.list first to get task_id. Spanish keywords: actualizar tarea, modificar cron, editar recordatorio, cambiar horario, actualizar programación", category: "scheduling", abstractionLevel: "atomic" },
    { name: "cron.pause", description: "Pause a cron job temporarily without deleting it. Spanish keywords: pausar tarea programada, detener temporalmente, suspender recordatorio", category: "scheduling", abstractionLevel: "atomic" },
    { name: "cron.resume", description: "Resume a previously paused cron job. Spanish keywords: reanudar tarea, continuar tarea pausada, activar recordatorio", category: "scheduling", abstractionLevel: "atomic" },
    { name: "cron.delete", description: "Delete a cron job permanently. Spanish keywords: eliminar tarea programada, borrar recordatorio, cancelar tarea", category: "scheduling", abstractionLevel: "atomic" },
    { name: "cron.trigger", description: "Manually trigger immediate execution of a cron job now. Spanish keywords: ejecutar tarea ahora, forzar ejecución, disparar manualmente", category: "scheduling", abstractionLevel: "atomic" },
    { name: "cron.history", description: "Get execution history and run logs for a cron job. Spanish keywords: historial ejecuciones, logs tarea, cuándo corrió, registro de ejecuciones", category: "scheduling", abstractionLevel: "atomic" },

    // Code execution
    { name: "cli_exec", description: "Execute shell commands, run bash scripts and system commands. Spanish keywords: ejecutar comando, terminal, línea de comandos, bash, script, comando del sistema", category: "cli", abstractionLevel: "atomic" },

    // Web tools
    { name: "web_search", description: "Search web for current information, find up-to-date news facts and research. Spanish keywords: buscar en internet, buscar web, información, noticias, investigación, buscar", category: "web", abstractionLevel: "atomic" },
    { name: "web_fetch", description: "Fetch content from URL, download and extract content from web pages. Spanish keywords: obtener página, descargar web, extraer contenido, obtener contenido, página web", category: "web", abstractionLevel: "atomic" },

    // Memory tools
    { name: "memory_write", description: "Store in long-term memory, save information to persistent memory for later retrieval. Spanish keywords: guardar memoria, guardar información, recordar, guardar dato, memoria", category: "memory", abstractionLevel: "atomic" },
    { name: "memory_read", description: "Retrieve from memory by title, fetch saved information using memory identifier. Spanish keywords: leer memoria, recuperar información, recordar, obtener dato, buscar memoria", category: "memory", abstractionLevel: "atomic" },
    { name: "memory_list", description: "List all memory entries, show all saved memories and stored knowledge. Spanish keywords: listar memorias, ver memorias guardadas, todas las memorias, lista de memorias", category: "memory", abstractionLevel: "atomic" },
    { name: "memory_search", description: "Search memory by content, find memories containing specific keywords. Spanish keywords: buscar en memoria, buscar información guardada, buscar en recuerdos", category: "memory", abstractionLevel: "atomic" },
    { name: "memory_delete", description: "Delete memory entry, remove saved memory from long-term storage. Spanish keywords: borrar memoria, eliminar información guardada, borrar dato, eliminar memoria", category: "memory", abstractionLevel: "atomic" },

    // Agent/worker management
    { name: "agent_create", description: "Create a specialized worker, including one persistent MCP server after user confirmation. Spanish keywords: crear agente, nuevo agente, trabajador, crear worker, especialista MCP", category: "agents", abstractionLevel: "orchestration" },
    { name: "agent_find", description: "Discover available system catalog agents and user-owned workers. Not an execution monitor. Spanish keywords: buscar agente, encontrar trabajador, localizar, buscar worker, encontrar agente", category: "agents", abstractionLevel: "atomic" },
    { name: "agent_archive", description: "Archive unnecessary worker, terminate and archive idle or completed agents. Spanish keywords: archivar agente, terminar agente, borrar trabajador, desactivar agente", category: "agents", abstractionLevel: "atomic" },

    // Notes/persistence
    { name: "save_note", description: "Save persistent note to scratchpad, write quick notes and reminders. Spanish keywords: guardar nota, escribir nota, recordatorio rápido, nota rápida, apuntar", category: "core", abstractionLevel: "atomic" },

    // Notifications/reporting
    { name: "notify", description: "Send system notification, alert user with message or alert. Spanish keywords: notificar, enviar notificación, alertar, aviso, alarma", category: "core", abstractionLevel: "atomic" },
    { name: "report_progress", description: "Report progress to user, inform user of current status and completion. Spanish keywords: reportar progreso, informar estado, actualizar,报告进度, progreso", category: "core", abstractionLevel: "atomic" },

    // Browser automation
    { name: "browser_navigate", description: "Navigate to URL and get content, open web pages and extract information. Spanish keywords: navegar web, abrir página, ir a sitio, navegar, ir a página", category: "browser", abstractionLevel: "atomic" },
    { name: "browser_screenshot", description: "Take webpage screenshot, capture visual snapshot of web page. Spanish keywords: captura de pantalla, screenshot, fotografiar página, imagen de página", category: "browser", abstractionLevel: "atomic" },
    { name: "browser_click", description: "Click element on page, interact with buttons and links in browser. Spanish keywords: hacer clic, presionar botón, clickear, pulsar, botón", category: "browser", abstractionLevel: "atomic" },
    { name: "browser_type", description: "Type into input field, fill forms and text inputs in browser. Spanish keywords: escribir en página, llenar formulario, introducir texto, completar formulario", category: "browser", abstractionLevel: "atomic" },
    { name: "browser_extract", description: "Extract text, links, or structured data from page using CSS selectors or XPath. Spanish keywords: extraer datos, obtener información, scraping, selectores, xpath", category: "browser", abstractionLevel: "atomic" },
    { name: "browser_script", description: "Execute arbitrary JavaScript in the browser page context and get the result. Spanish keywords: ejecutar javascript, script, código, función, evaluar, js en página", category: "browser", abstractionLevel: "atomic" },
    { name: "browser_wait", description: "Wait for an element to appear or condition to be met on the page. Spanish keywords: esperar, wait, condición, elemento, selector, aguardar carga", category: "browser", abstractionLevel: "atomic" },

    // A2UI v0.9 rich interactive surfaces
    { name: "a2ui_create_surface", description: "Create A2UI v0.9 surface for rich interactive UIs with forms, dashboards, and workflows. Spanish keywords: crear superficie A2UI, iniciar UI interactiva, crear formulario rico, interfaz A2UI, crear surface", category: "a2ui", abstractionLevel: "orchestration" },
    { name: "a2ui_update_components", description: "Send A2UI v0.9 components to an existing surface (Text, Button, TextField, Row, Column, Card, etc.). Spanish keywords: enviar componentes A2UI, actualizar UI, renderizar componentes, A2UI componentes, update components", category: "a2ui", abstractionLevel: "atomic" },
    { name: "a2ui_update_data_model", description: "Update A2UI v0.9 surface data model with JSON Pointer for dynamic data binding. Spanish keywords: actualizar datos A2UI, poblar formulario, cambiar valores, data model A2UI, actualizar modelo de datos", category: "a2ui", abstractionLevel: "atomic" },
    { name: "a2ui_delete_surface", description: "Delete A2UI v0.9 surface from the user's interactive panel. Spanish keywords: eliminar superficie A2UI, borrar UI, limpiar superficie A2UI, cerrar formulario, delete surface", category: "a2ui", abstractionLevel: "atomic" },

    // Filesystem tools
    { name: "fs_read", description: "Read file content from workspace. Spanish keywords: leer archivo, ver contenido, abrir archivo, leer fichero, mostrar archivo", category: "filesystem", abstractionLevel: "atomic" },
    { name: "fs_write", description: "Create or overwrite file in workspace. Spanish keywords: crear archivo, guardar archivo, escribir archivo, crear fichero, escribir fichero", category: "filesystem", abstractionLevel: "atomic" },
    { name: "fs_edit", description: "Edit specific lines or sections of a file. Spanish keywords: editar archivo, modificar líneas, actualizar contenido, cambiar archivo", category: "filesystem", abstractionLevel: "atomic" },
    { name: "fs_delete", description: "Delete file or directory. Spanish keywords: eliminar archivo, borrar archivo, borrar carpeta, eliminar fichero", category: "filesystem", abstractionLevel: "atomic" },
    { name: "fs_list", description: "List files and directories. Spanish keywords: listar archivos, ver carpeta, explorar directorio, listar ficheros", category: "filesystem", abstractionLevel: "atomic" },
    { name: "fs_glob", description: "Find files matching wildcard patterns. Spanish keywords: buscar archivos, patrón, encontrar archivos, buscar ficheros", category: "filesystem", abstractionLevel: "atomic" },
    { name: "fs_exists", description: "Check if a file or directory exists. Spanish keywords: verificar archivo, comprobar, existe archivo, comprobar fichero", category: "filesystem", abstractionLevel: "atomic" },

    // Agent delegation and communication
    { name: "task_delegate", description: "Delegate general task to worker agent. Spanish keywords: delegar tarea, asignar worker, ejecutar por agente, encomendar tarea", category: "agents", abstractionLevel: "orchestration" },
    { name: "task_list", description: "List real delegated task executions for the current user from persisted tasks and jobs. Spanish keywords: listar tareas activas, subagentes trabajando, ejecuciones reales", category: "agents", abstractionLevel: "atomic" },
    { name: "task_status", description: "Get execution status of delegated tasks. Spanish keywords: estado tarea delegada, verificar progreso, consultar tarea, progreso delegado", category: "agents", abstractionLevel: "atomic" },
    { name: "bus_publish", description: "Publish message to Agent Bus for worker-to-worker communication. Spanish keywords: publicar mensaje, comunicar workers, enviar bus, mensaje bus", category: "agents", abstractionLevel: "atomic" },
    { name: "bus_read", description: "Read unread messages from Agent Bus. Spanish keywords: leer mensajes bus, recibir mensajes, verificar bus, mensajes workers", category: "agents", abstractionLevel: "atomic" },

    // Model discovery
    { name: "get_available_models", description: "List configured providers and models with their capabilities and context windows. Spanish keywords: modelos disponibles, proveedores activos, qué modelos hay, listar modelos", category: "agents", abstractionLevel: "atomic" },

    // Capability discovery
    { name: "search_knowledge", description: "Search everything Hive knows: native tools, MCP tools, skills, catalog agents and playbook rules. Spanish keywords: buscar herramienta, descubrir capacidades, qué puedo hacer, buscar skill, buscar conocimiento", category: "core", abstractionLevel: "atomic" },

    // HTTP / REST
    { name: "api_request", description: "Perform an authorized HTTP request against a REST endpoint and validate the response. Spanish keywords: llamar api, request rest, consumir endpoint, petición http, hacer get, hacer post", category: "api", abstractionLevel: "atomic" },

    // Artifacts
    { name: "artifact_inspect", description: "Inspect a managed artifact's integrity and metadata without modifying it. Spanish keywords: inspeccionar artefacto, verificar archivo generado, metadatos artefacto, comprobar entrega", category: "web", abstractionLevel: "atomic" },

    // Office documents — read
    { name: "office_leer_pdf", description: "Read and extract text from a PDF document. Spanish keywords: leer pdf, extraer texto pdf, abrir pdf, contenido pdf", category: "office", abstractionLevel: "atomic" },
    { name: "office_leer_docx", description: "Read and extract text from a Word document. Spanish keywords: leer word, leer docx, abrir documento word, contenido word", category: "office", abstractionLevel: "atomic" },
    { name: "office_leer_xlsx", description: "Read rows and sheets from an Excel spreadsheet. Spanish keywords: leer excel, leer xlsx, abrir hoja de cálculo, contenido excel, leer planilla", category: "office", abstractionLevel: "atomic" },
    { name: "office_leer_pptx", description: "Read slides and text from a PowerPoint presentation. Spanish keywords: leer powerpoint, leer pptx, abrir presentación, contenido diapositivas", category: "office", abstractionLevel: "atomic" },

    // Office documents — write
    { name: "office_escribir_pdf", description: "Generate a PDF document. Spanish keywords: crear pdf, generar pdf, escribir pdf, exportar a pdf", category: "office", abstractionLevel: "atomic" },
    { name: "office_escribir_docx", description: "Generate a Word document. Spanish keywords: crear word, generar docx, escribir documento word, exportar a word", category: "office", abstractionLevel: "atomic" },
    { name: "office_escribir_xlsx", description: "Generate an Excel spreadsheet. Spanish keywords: crear excel, generar xlsx, escribir hoja de cálculo, exportar a excel, armar planilla", category: "office", abstractionLevel: "atomic" },
    { name: "office_escribir_pptx", description: "Generate a PowerPoint presentation. Spanish keywords: crear powerpoint, generar pptx, escribir presentación, armar diapositivas", category: "office", abstractionLevel: "atomic" },
]

// ─── Helper Functions ───────────────────────────────────────────────────────-

/**
 * Check if message is purely conversational (no tools needed)
 * 
 * Uses pattern matching for common conversational phrases.
 * Also checks for very short messages that are likely greetings.
 */
function isConversational(message: string): boolean {
    log.info(`[tool-selector] Checking if message is conversational: "${message}"`)
    const trimmed = message.trim()

    // Empty or very short messages
    if (trimmed.length < 2) return true

    // Check conversational patterns
    for (const pattern of CONVERSATIONAL_PATTERNS) {
        if (pattern.test(trimmed)) {
            log.debug(`[tool-selector] Message matched conversational pattern: ${pattern}`)
            return true
        }
    }

    // Check if all words are stopwords (likely conversational)
    const words = trimmed.toLowerCase().split(/\s+/)
    const meaningfulWords = words.filter(w => w.length > 2 && !STOPWORDS.has(w))
    if (meaningfulWords.length === 0) {
        log.debug(`[tool-selector] All words are stopwords - conversational`)
        return true
    }

    return false
}

/**
 * Determine abstraction level preference
 * 
 * Returns 'atomic' to prefer individual tools, 'orchestration' to prefer
 * manager tools. Currently always prefers atomic for better control.
 */
function getAbstractionPreference(): "atomic" | "orchestration" {
    // Prefer atomic tools for more predictable behavior
    return "atomic"
}

// ─── Main Selection Function ─────────────────────────────────────────────────

/**
 * Select tools for a given user message using HiveDB BM25 scoring
 *
 * @param userMessage - The raw user message
 * @param fullToolList - Full list of available tools (for validation/filtering)
 * @returns Array of selected tools
 *
 * ALGORITHM:
 * 1. If conversational → return []
 * 2. Query the HiveDB capability index with the raw message (the engine
 *    handles Spanish stemming, accent folding and malformed input)
 * 3. Keep hits scoring at least RELEVANCE_RATIO of the top hit
 * 4. If ambiguous → prefer atomic over orchestration
 * 5. Return top maxTools results (default: MAX_TOOLS_PER_TURN)
 */
export async function selectTools(
    userMessage: string,
    fullToolList: ToolDescriptor[] = CORE_TOOL_CATALOG,
    maxTools: number = MAX_TOOLS_PER_TURN
): Promise<ToolDescriptor[]> {
    const startTime = performance.now()

    // Log incoming user message for debugging/validation
    log.debug(`[tool-selector] Processing user message: "${userMessage.substring(0, 100)}"`)

    // Step 1: Check if conversational
    if (isConversational(userMessage)) {
        log.debug(`[tool-selector] Conversational message, returning empty array`)
        return []
    }

    // Step 2: Query the capability index with the raw message.
    // Get more initially (maxTools * 2) for filtering, then limit to maxTools.
    let hits
    try {
        hits = await searchCapabilities(userMessage, {
            types: ["tool"],
            k: maxTools * 2,
        })
    } catch (err) {
        log.error(`[tool-selector] Capability search failed:`, err)
        return []
    }

    if (hits.length === 0) {
        log.debug(`[tool-selector] No matches, returning empty array`)
        return []
    }

    // Log raw scores for debugging
    log.info(`[tool-selector] Raw scores: ${hits.slice(0, 10).map(h => `${h.rawId}=${h.score.toFixed(2)}`).join(", ")}`)

    // Step 3: Keep only hits close enough to the best match
    const relevantHits = applyRelativeCutoff(hits, RELEVANCE_RATIO)
    if (relevantHits.length === 0) {
        log.debug(`[tool-selector] All results below ratio cutoff, returning empty`)
        return []
    }

    // Step 4: Map to tool descriptors with additional metadata
    const toolMap = new Map(fullToolList.map(t => [t.name, t]))
    const calendarOperation = isCalendarOperation(userMessage)

    const scoredTools: SelectedTool[] = []
    for (const hit of relevantHits) {
        const tool = toolMap.get(hit.rawId)
        if (tool && !(calendarOperation && tool.category === "scheduling")) {
            scoredTools.push({
                name: tool.name,
                score: hit.score,
                category: tool.category,
            })
        }
    }

    // Step 5: Prefer atomic over orchestration when ambiguous
    const abstractionPref = getAbstractionPreference()

    if (scoredTools.length > MAX_TOOLS_PER_TURN) {
        scoredTools.sort((a, b) => {
            // First by score (descending: HiveDB scores are positive, higher = better)
            if (Math.abs(a.score - b.score) > 0.1) {
                return b.score - a.score
            }
            // Then by abstraction preference (preferred type first)
            const aTool = toolMap.get(a.name)
            const bTool = toolMap.get(b.name)
            const aLevel = aTool?.abstractionLevel ?? "atomic"
            const bLevel = bTool?.abstractionLevel ?? "atomic"

            if (abstractionPref === "atomic") {
                return (aLevel === "atomic" ? -1 : 1)
            } else {
                return (aLevel === "orchestration" ? -1 : 1)
            }
        })
    }

    // Step 6: Take top N tools
    const topTools = scoredTools.slice(0, maxTools)

    // Step 7: Return as ToolDescriptor array
    const result = topTools.map(t => toolMap.get(t.name)!).filter(Boolean)

    const timing = performance.now() - startTime

    // Log final selected tools with info level (important for tracking tool selection process)
    if (result.length > 0) {
        log.info(`[tool-selector] Selected ${result.length} tools in ${timing.toFixed(2)}ms:`,
            result.map(t => ({ name: t.name, category: t.category })))
    } else {
        log.debug(`[tool-selector] No tools selected, returning empty array in ${timing.toFixed(2)}ms`)
    }

    return result
}

// ─── Sync Tools to HiveDB ────────────────────────────────────────────────────

/**
 * Sync tool catalog to the HiveDB capability index.
 *
 * Called on initialization from gateway/initializer.ts to populate the index.
 * Replaces all `type=tool` documents atomically (delete-by-filter + one
 * batch commit). Descriptions are enriched with bilingual keywords.
 *
 * @param tools - Optional array of tools to sync. If not provided, fetches from DB.
 */
export async function syncToolCatalogToIndex(tools?: ToolDescriptor[]): Promise<void> {
    try {
        // Step 1: Build full catalog = CORE_TOOL_CATALOG + any tools in DB not already covered
        // CORE_TOOL_CATALOG has bilingual keywords; DB tools may be dynamically registered
        const catalogByName = new Map<string, ToolDescriptor>(
            CORE_TOOL_CATALOG.map(t => [t.name, t])
        )

        // Merge in any tools from the DB that are missing from the static catalog
        const toolsCol = await col<ToolDoc>("tools")
        const dbTools = (await toolsCol.scan({})).map(e => e.doc)
        for (const row of dbTools) {
            if (catalogByName.has(row.name)) continue

            // Check if this is a legacy name with different separator
            // (e.g. "cron_create" vs "cron.create" — seed was wrong, tools use dots)
            const altName = row.name.includes("_")
                ? row.name.replace(/_/g, ".")
                : row.name.includes(".")
                    ? row.name.replace(/\./g, "_")
                    : ""
            if (altName && catalogByName.has(altName)) {
                log.info(`[tool-selector] Skipping legacy tool name "${row.name}" — canonical "${altName}" already in catalog`)
                continue
            }

            catalogByName.set(row.name, {
                name: row.name,
                description: row.description ?? row.name,
                category: (row.category ?? "core") as any,
                abstractionLevel: "atomic",
            })
        }

        // Also merge any explicitly passed tools (e.g. from initializer)
        for (const t of (tools || [])) {
            if (!catalogByName.has(t.name)) {
                catalogByName.set(t.name, t)
            }
        }

        const toolCatalog = Array.from(catalogByName.values())

        // Step 2: Replace all tool documents in the HiveDB capability index
        const docs: CapabilityDoc[] = toolCatalog.map(tool => ({
            type: "tool" as const,
            rawId: tool.name,
            name: tool.name,
            body: enrichToolDescription(tool),
            tags: tool.category,
        }))

        await replaceCapabilityDocs("tool", docs)

        log.info(`[tool-selector] Sync complete: ${toolCatalog.length} tools indexed in HiveDB`)

    } catch (err) {
        log.error(`[tool-selector] Tool index sync failed:`, err)
        throw err // Re-throw to inform initializer
    }
}

/**
 * Enrich tool description with category-specific keywords
 * 
 * This improves BM25 matching for both English and Spanish queries.
 */
function enrichToolDescription(tool: ToolDescriptor): string {
    const keywordsByCategory: Record<string, string> = {
        scheduling: "programar recordatorio alarma cron schedule reminder task future tiempo",
        filesystem: "archivo file leer escribir editar documento content source code",
        web: "buscar internet google web search find information news research",
        browser: "navegador browser click screenshot form automation web page UI",
        memory: "recordar nota guardar memory store remember persist knowledge",
        code: "code ejecutar run script bash shell terminal command devops",
        a2ui: "A2UI interactive panel interface form dashboard visualization",
        agents: "agente worker catalog create delegate hire team manager",
        core: "notificar message alert notify communicate progress status",
    }

    const extra = keywordsByCategory[tool.category] ?? ""
    return `${tool.description} ${extra}`
}

// ─── Initialization ─────────────────────────────────────────────────────────

/**
 * Sanitize an MCP tool name to comply with LLM function-name rules.
 *
 * Gemini (and OpenAI) require: start with letter/underscore, only [a-zA-Z0-9_.-:], max 64 chars.
 * Server names from the UI can contain spaces and special chars (e.g. "X antes twiter").
 *
 * Canonical format: `{safeServer}__{safeTool}` (double underscore as separator).
 * The server prefix exists only to disambiguate tools with the same name
 * across servers — when the 64-char budget is exceeded, the SERVER part is
 * shortened first so the distinctive tool name survives intact (long server
 * names must never truncate the tool name).
 */
export function mcpToolFullName(serverName: string, toolName: string): string {
    const MAX = 64
    const MIN_SERVER = 8
    const safe = (s: string) => s.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '_')

    let server = safe(serverName)
    const tool = safe(toolName)

    const room = MAX - 2 - tool.length
    if (server.length > room) {
        server = server.substring(0, Math.max(room, MIN_SERVER))
    }

    let full = `${server}__${tool}`
    if (full.length > MAX) full = full.substring(0, MAX)
    return /^[a-zA-Z_]/.test(full) ? full : `_${full}`.substring(0, MAX)
}

// ─── Debug/Test Helpers ─────────────────────────────────────────────────────

/**
 * Get all tools (for debugging/testing)
 */
export function getAllTools(): ToolDescriptor[] {
    return [...CORE_TOOL_CATALOG]
}

/**
 * Get tool by name
 */
export function getToolByName(name: string): ToolDescriptor | undefined {
    return CORE_TOOL_CATALOG.find(t => t.name === name)
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: string): ToolDescriptor[] {
    return CORE_TOOL_CATALOG.filter(t => t.category === category)
}
