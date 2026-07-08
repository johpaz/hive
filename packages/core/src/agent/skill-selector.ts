/**
 * HiveDB-based Dynamic Skill Selector Module
 *
 * Context Compiler Level 4 - Intelligent Skill Selection
 *
 * This module uses HiveDB BM25 scoring (Spanish stemming + accent folding)
 * to select the most relevant skills based on the user message, similar to
 * tool selection.
 *
 * DESIGN DECISIONS:
 *
 * 1. Reads from skills table in database (not hardcoded catalog)
 * 2. Maximum skills per turn for balanced context injection
 * 3. Explicit triggers checked first; search is the semantic fallback
 * 4. Relative score cutoff (fraction of the top hit), never absolute
 * 5. Returns skill content for injection into system prompt
 */

import { getDb } from "../storage/sqlite"
import { logger } from "../utils/logger"
import {
    searchCapabilities,
    applyRelativeCutoff,
    replaceCapabilityDocs,
    type CapabilityDoc,
} from "./capability-search"

const log = logger.child("skill-selector")

// ─── Minimal Skill Set ─────────────────────────────────────────────────────────

/**
 * Skills mínimas que SIEMPRE están disponibles (asociadas a las 4 tools iniciales)
 * - memory_manager: usa save_note (notas persistentes)
 * - canvas_report: usa report_progress (reportes de progreso)
 * - task_orchestrator: usa notify (comunicación entre agentes)
 */
export const MINIMAL_SKILL_NAMES = new Set([
  "busqueda_fts5",    // Core: cómo descubrir tools, MCP, skills, playbook
  "memory_manager",   // Asociada a save_note
  "canvas_report",    // Asociada a report_progress
  "task_orchestrator", // Asociada a notify y agent coordination
])

// ─── Types ───────────────────────────────────────────────────────────────────────

export interface SkillDescriptor {
    id: string
    name: string
    description: string
    category: string
    tools: string
    triggers: string
    preferred_agents: string
    body: string
    version: string
    version_num: number
    active: number
}

export interface SelectedSkill {
    id: string
    name: string
    score: number
    category: string
    description: string
    body: string
}

export interface SkillSelectorResult {
    skills: SkillDescriptor[]
    selected: SelectedSkill[]
    reasoning: string
    timingMs: number
}

// ─── Configuration ─────────────────────────────────────────────────────────

/** Maximum skills to return per message */
const MAX_SKILLS_PER_TURN = 4  // Increased from 2 to allow more skills

/**
 * Relative relevance cutoff: keep a hit only if it scores at least this
 * fraction of the top hit. HiveDB BM25 scores are positive (higher = better)
 * but corpus-dependent, so absolute thresholds don't transfer — a ratio does.
 */
const RELEVANCE_RATIO = 0.3

/** Stopwords to filter out before FTS5 query construction */
const STOPWORDS = new Set([
    "que", "con", "para", "por", "una", "uno", "los", "las", "del",
    "como", "esta", "esto", "ese", "eso", "the", "and", "for",
    "with", "this", "that", "have", "will", "also", "de", "en",
    "el", "la", "se", "su", "sus", "al", "es", "son", "pero",
    "más", "mas", "ya", "yo", "tu", "te", "ti", "mi", "me",
    "hola", "hi", "hello", "hey", "gracias", "thank", "please",
    "ok", "okay", "yes", "si", "no", "bien", "good", "great",
    "puedes", "necesito", "quiero", "podés", "necesitás", "querés",
])

/** Conversational patterns that should return empty skill list */
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

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Check if message is purely conversational (no skills needed)
 */
function isConversational(message: string): boolean {
    const trimmed = message.trim()

    // Empty or very short messages
    if (trimmed.length < 2) return true

    // Check conversational patterns
    for (const pattern of CONVERSATIONAL_PATTERNS) {
        if (pattern.test(trimmed)) {
            log.debug(`[skill-selector] Message matched conversational pattern: ${pattern}`)
            return true
        }
    }

    // Check if all words are stopwords (likely conversational)
    const words = trimmed.toLowerCase().split(/\s+/)
    const meaningfulWords = words.filter(w => w.length > 2 && !STOPWORDS.has(w))
    if (meaningfulWords.length === 0) {
        log.debug(`[skill-selector] All words are stopwords - conversational`)
        return true
    }

    return false
}

/**
 * Check if message matches explicit triggers from a skill
 */
function matchTriggers(message: string, triggersJson: string | null): boolean {
    if (!triggersJson) return false

    try {
        // Triggers are stored as comma-separated string in DB (e.g., "trigger1,trigger2")
        const triggers: string[] = triggersJson.split(",").map(t => t.trim()).filter(t => t.length > 0)
        if (triggers.length === 0) return false

        const lowerMessage = message.toLowerCase()
        return triggers.some(trigger =>
            lowerMessage.includes(trigger.toLowerCase())
        )
    } catch (err) {
        log.warn(`[skill-selector] Failed to parse triggers: ${(err as Error).message}`)
        return false
    }
}

// ─── Main Selection Function ─────────────────────────────────────────────────

/**
 * Select skills for a given user message using hybrid matching:
 * 1. First check explicit triggers (high confidence match)
 * 2. Fallback to HiveDB BM25 scoring for semantic matching
 *
 * @param userMessage - The raw user message
 * @returns Array of selected skills
 *
 * ALGORITHM:
 * 1. If conversational → return []
 * 2. Check explicit triggers from all enabled skills
 * 3. If trigger match found → return matching skill immediately
 * 4. Query the HiveDB capability index with the raw message
 * 5. Keep hits scoring at least RELEVANCE_RATIO of the top hit
 * 6. Hydrate skill details from SQLite and return top MAX_SKILLS_PER_TURN
 */
export async function selectSkills(userMessage: string): Promise<SkillDescriptor[]> {
    const startTime = performance.now()

    log.debug(`[skill-selector] Processing user message: "${userMessage.substring(0, 100)}"`)

    // Step 1: Check if conversational
    if (isConversational(userMessage)) {
        log.debug(`[skill-selector] Conversational message, returning empty array`)
        return []
    }

    // Step 2: Check explicit triggers first (high priority)
    const db = getDb()
    const allSkills = db.query(`
        SELECT id, name, description, category, tools, triggers, preferred_agents, body, version, version_num, active
        FROM skills
        WHERE active = 1
    `).all() as SkillDescriptor[]

    // Check trigger match - if found, return immediately with high confidence
    for (const skill of allSkills) {
        if (skill.triggers && matchTriggers(userMessage, skill.triggers)) {
            log.info(`[skill-selector] Trigger match found: ${skill.name}`)
            return [skill]
        }
    }

    // Step 3: Semantic matching via the HiveDB capability index
    let hits
    try {
        hits = await searchCapabilities(userMessage, { types: ["skill"], k: 20 })
    } catch (err) {
        log.error(`[skill-selector] Capability search failed:`, err)
        return []
    }

    if (hits.length === 0) {
        log.debug(`[skill-selector] No matches, returning empty array`)
        return []
    }

    // Log raw scores for debugging
    log.info(`[skill-selector] Raw scores: ${hits.slice(0, 10).map(h => `id=${h.rawId}, score=${h.score.toFixed(2)}`).join(", ")}`)

    // Step 4: Keep only hits close enough to the best match
    const relevantHits = applyRelativeCutoff(hits, RELEVANCE_RATIO)
    if (relevantHits.length === 0) {
        log.debug(`[skill-selector] All results below ratio cutoff, returning empty`)
        return []
    }

    // Step 5: Hydrate full skill details from SQLite (already loaded above)
    const skillMap = new Map(allSkills.map(s => [s.id, s]))
    const result: SkillDescriptor[] = []

    for (const hit of relevantHits) {
        const skill = skillMap.get(hit.rawId)
        if (skill) {
            result.push(skill)
            if (result.length === MAX_SKILLS_PER_TURN) break
        }
    }

    const timing = performance.now() - startTime

    if (result.length > 0) {
        log.info(`[skill-selector] Selected ${result.length} skills in ${timing.toFixed(2)}ms:`,
            result.map(s => ({ name: s.name, category: s.category })))
    } else {
        log.debug(`[skill-selector] No skills selected, returning empty array in ${timing.toFixed(2)}ms`)
    }

    return result
}

// ─── Minimal Skills Loader ───────────────────────────────────────────────────

/**
 * Load minimal skills that are ALWAYS available (associated with MINIMAL_TOOLS)
 * These are loaded at startup, not via FTS5 search.
 *
 * @returns Array of minimal skills (memory_manager, canvas_report, task_orchestrator)
 */
export function getMinimalSkills(): SkillDescriptor[] {
    const db = getDb()

    try {
        const placeholders = Array.from(MINIMAL_SKILL_NAMES).map(() => "?").join(",")
        const skills = db.query(`
            SELECT id, name, description, category, tools, triggers, preferred_agents, body, version, version_num, active
            FROM skills
            WHERE name IN (${placeholders})
            AND active = 1
        `).all(...MINIMAL_SKILL_NAMES) as SkillDescriptor[]

        log.info(`[skill-selector] Loaded ${skills.length} minimal skills: ${skills.map(s => s.name).join(", ")}`)
        return skills
    } catch (err) {
        log.error(`[skill-selector] Failed to load minimal skills:`, err)
        return []
    }
}

// ─── Sync Skills to HiveDB ───────────────────────────────────────────────────

/**
 * Sync all enabled skills from database to the HiveDB capability index.
 * Should be called on initialization from gateway/initializer.ts.
 * Replaces all `type=skill` documents atomically (delete-by-filter + one
 * batch commit).
 */
export async function syncSkillsToFTS(): Promise<void> {
    const db = getDb()

    try {
        // Step 1: Get all enabled skills from database
        const dbSkills = db.query(`
            SELECT id, name, description, category, tools, triggers, body
            FROM skills
            WHERE active = 1
        `).all() as Array<{
            id: string
            name: string
            description: string
            category: string
            tools: string
            triggers: string
            body: string
        }>

        if (dbSkills.length === 0) {
            log.debug(`[skill-selector] No skills found in DB to sync`)
        }

        // Step 2: Replace all skill documents in the HiveDB capability index.
        // name (boost 4.0) = skill name; tags (3.0) = triggers + category +
        // tools (the strongest semantic signals); body (2.0) = description +
        // full skill body.
        const docs: CapabilityDoc[] = dbSkills.map(skill => ({
            type: "skill" as const,
            rawId: skill.id,
            name: skill.name,
            tags: [skill.triggers, skill.category, skill.tools].filter(Boolean).join(" "),
            body: [skill.description, skill.body].filter(Boolean).join("\n"),
        }))

        await replaceCapabilityDocs("skill", docs)

        log.info(`[skill-selector] Sync complete: ${dbSkills.length} skills indexed in HiveDB`)

    } catch (err) {
        log.error(`[skill-selector] Skill index sync failed:`, err)
        throw err // Re-throw to inform initializer
    }
}
// ─── Initialization ───────────────────────────────────────────────────────

/**
 * Initialize the skill selector
 * DEPRECATED: syncSkillsToFTS() is now called from gateway/initializer.ts
 * This function is kept for backward compatibility but is no longer needed
 */
export function initializeSkillSelector(): void {
    log.info(`[skill-selector] Initializing skill selector (deprecated - sync is done in gateway/initializer.ts)`)
    // syncSkillsToFTS() - No longer needed here, done in gateway/initializer.ts
}

// ─── Debug/Test Helpers ─────────────────────────────────────────────────────

/**
 * Get all enabled skills from database (for debugging/testing)
 */
export function getAllSkillsFromDB(): SkillDescriptor[] {
    try {
        const db = getDb()
        return db.query(`
            SELECT id, name, description, category, tools, triggers, preferred_agents, body, version, version_num, active
            FROM skills
            WHERE active = 1
        `).all() as SkillDescriptor[]
    } catch (err) {
        log.error(`[skill-selector] Failed to fetch skills:`, err)
        return []
    }
}

/**
 * Get skill by name
 */
export function getSkillByName(name: string): SkillDescriptor | undefined {
    try {
        const db = getDb()
        return db.query(`
            SELECT id, name, description, category, tools, triggers, preferred_agents, body, version, version_num, active
            FROM skills
            WHERE name = ? AND active = 1
        `).get(name) as SkillDescriptor | undefined
    } catch (err) {
        log.error(`[skill-selector] Failed to fetch skill by name:`, err)
        return undefined
    }
}

/**
 * Get skills by category
 */
export function getSkillsByCategory(category: string): SkillDescriptor[] {
    try {
        const db = getDb()
        return db.query(`
            SELECT id, name, description, category, tools, triggers, preferred_agents, body, version, version_num, active
            FROM skills
            WHERE category = ? AND active = 1
        `).all(category) as SkillDescriptor[]
    } catch (err) {
        log.error(`[skill-selector] Failed to fetch skills by category:`, err)
        return []
    }
}
