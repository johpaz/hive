/**
 * FTS5-based Dynamic Skill Selector Module
 * 
 * Context Compiler Level 4 - Intelligent Skill Selection
 * 
 * This module uses SQLite FTS5 bm25() scoring to select the most relevant
 * skills (0-5) based on the user message, similar to tool selection.
 * 
 * DESIGN DECISIONS:
 * 
 * 1. Reads from skills table in database (not hardcoded catalog)
 * 2. Maximum 5 skills per turn for balanced context injection
 * 3. Relevance threshold for conversational messages
 * 4. Uses skill descriptions for FTS5 matching
 * 5. Returns skill content for injection into system prompt
 */

import { getDb } from "../storage/sqlite"
import { logger } from "../utils/logger"

const log = logger.child("skill-selector")

// ─── Minimal Skill Set ─────────────────────────────────────────────────────────

/**
 * Skills mínimas que SIEMPRE están disponibles (asociadas a las 4 tools iniciales)
 * - memory_manager: usa save_note (notas persistentes)
 * - canvas_report: usa report_progress (reportes de progreso)
 * - task_orchestrator: usa notify (comunicación entre agentes)
 */
export const MINIMAL_SKILL_NAMES = new Set([
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
 * Minimum bm25 score threshold. Below this = conversational, no skills needed.
 * 
 * CRITICAL: bm25() returns NEGATIVE scores where closer to 0 = more relevant.
 * - Score of -5 is MORE relevant than -20
 * - We use -15 as threshold to allow reasonable matching while filtering noise
 */
const MIN_RELEVANCE_THRESHOLD = -15  // Increased from -5 to allow more matches

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
 * Build FTS5 query from user message
 * 
 * Uses prefix matching for better recall:
 * - "generar" matches "generando", "generación", "genera"
 * - "código" matches "codigos", "codificar"
 */
function buildFTSQuery(message: string): string {
    const words = message
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
        .slice(0, 8)

    if (words.length === 0) return ""

    // Use prefix matching for better recall (e.g., "gener*" matches "generar", "generando", "generación")
    return words.map(w => `${w}*`).join(" OR ")
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
 * 2. Fallback to FTS5 bm25() scoring for semantic matching
 *
 * @param userMessage - The raw user message
 * @returns Array of 0-5 selected skills with scores
 *
 * ALGORITHM:
 * 1. If conversational → return []
 * 2. Check explicit triggers from all enabled skills
 * 3. If trigger match found → return matching skill immediately
 * 4. Build FTS5 query from message keywords
 * 5. Query skills_fts with bm25() scoring
 * 6. Filter results below MIN_RELEVANCE_THRESHOLD
 * 7. Return top MAX_SKILLS_PER_TURN results
 */
export function selectSkills(userMessage: string): SkillDescriptor[] {
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

    // Step 3: Build FTS5 query for semantic matching
    const ftsQuery = buildFTSQuery(userMessage)
    if (!ftsQuery) {
        log.debug(`[skill-selector] No valid FTS query terms, returning empty array`)
        return []
    }

    log.debug(`[skill-selector] FTS query: "${ftsQuery}"`)

    // Step 4: Execute FTS5 query with bm25 scoring
    // Use bm25() with column weights for relevance scoring
    // FTS5 table columns: id, name, description, category, tools, triggers, body
    // Weights: id=1.0, name=4.0, description=5.0, category=1.0, tools=1.0, triggers=5.0, body=2.0
    // Higher weight on description (5.0) and triggers (5.0) for best semantic matching
    const ftsResults = db.query(`
        SELECT id, bm25(skills_fts, 1.0, 4.0, 5.0, 1.0, 1.0, 5.0, 2.0) as bm25_score
        FROM skills_fts
        WHERE skills_fts MATCH ?
        ORDER BY bm25_score ASC
        LIMIT 20
    `).all(ftsQuery) as { id: string; bm25_score: number }[]

    if (ftsResults.length === 0) {
        log.debug(`[skill-selector] No FTS matches, returning empty array`)
        return []
    }

    // Log raw scores for debugging
    log.info(`[skill-selector] Raw FTS scores: ${ftsResults.slice(0, 10).map(r => `id=${r.id}, score=${r.bm25_score.toFixed(2)}`).join(", ")}`)

    // Step 5: Apply relevance threshold filter
    const relevantResults = ftsResults.filter(r => r.bm25_score >= MIN_RELEVANCE_THRESHOLD)

    if (relevantResults.length === 0) {
        log.debug(`[skill-selector] All results below threshold ${MIN_RELEVANCE_THRESHOLD}, returning empty`)
        return []
    }

    // Step 6: Fetch full skill details from database
    const skillIds = relevantResults.map(r => r.id)

    let dbSkills: SkillDescriptor[] = []
    try {
        const db = getDb()
        dbSkills = db.query(`
            SELECT id, name, description, category, tools, triggers, preferred_agents, body, version, version_num, active
            FROM skills
            WHERE id IN (${skillIds.map(() => '?').join(',')})
            AND active = 1
        `).all(...skillIds) as SkillDescriptor[]
    } catch (err) {
        log.warn(`[skill-selector] Failed to fetch skills from DB:`, err)
        return []
    }

    // Map scores to skills
    const skillMap = new Map(dbSkills.map(s => [s.id, s]))
    const scoredSkills: SelectedSkill[] = []

    for (const result of relevantResults) {
        const skill = skillMap.get(result.id)
        if (skill) {
            scoredSkills.push({
                id: skill.id,
                name: skill.name,
                score: result.bm25_score,
                category: skill.category,
                description: skill.description || "",
                body: skill.body,
            })
        }
    }

    // Step 7: Take top N skills
    const topSkills = scoredSkills.slice(0, MAX_SKILLS_PER_TURN)

    // Step 8: Return as SkillDescriptor array
    const result = topSkills.map(t => skillMap.get(t.id)!).filter(Boolean)

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

// ─── Sync Skills to FTS5 ───────────────────────────────────────────────────

/**
 * Sync all enabled skills from database to FTS5
 * Should be called on initialization from gateway/initializer.ts
 * The skills_fts table is created by schema.ts (v0.0.28 includes description)
 */
export async function syncSkillsToFTS(): Promise<void> {
    const db = getDb()

    try {
        // Step 1: Get all enabled skills from database (v0.0.28 schema with description)
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

        // Step 2: Atomic transaction for FTS5 sync
        const syncTransaction = db.transaction(() => {
            // Verify table exists
            const tableCheck = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='skills_fts'").get()
            if (!tableCheck) {
                throw new Error("skills_fts table does not exist!")
            }

            // A: Clear existing data
            db.run("DELETE FROM skills_fts")

            // B: Prepare insertion (v0.0.28 schema with description)
            const insert = db.prepare(`
                INSERT INTO skills_fts(id, name, description, category, tools, triggers, body)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `)

            // C: Re-populate
            for (const skill of dbSkills) {
                insert.run(
                    skill.id,
                    skill.name,
                    skill.description || "",
                    skill.category,
                    skill.tools,
                    skill.triggers,
                    skill.body
                )
            }
        })

        // Execute transaction
        syncTransaction()

        log.info(`[skill-selector] Atomic sync complete: ${dbSkills.length} skills indexed in FTS5`)

    } catch (err) {
        log.error(`[skill-selector] Transactional sync failed:`, err)
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
