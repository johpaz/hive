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

import { col } from "../storage/hive"
import type { SkillDoc } from "../storage/collections"
import { logger } from "../utils/logger"
import { isMinimalSkill } from "./minimal-loadout"
import { isCalendarOperation } from "./routing-intent"
import {
    searchCapabilities,
    applyRelativeCutoff,
    replaceCapabilityDocs,
    type CapabilityDoc,
} from "./capability-search"

const log = logger.child("skill-selector")



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
    active: boolean
}

/**
 * Every bundled SKILL.md self-titles right after its frontmatter (e.g.
 * "# Canvas Report Skill\n\n## Cuándo se Activa...") for standalone
 * readability — but every system-prompt injection site wraps the body with
 * its own `## <skill.name>` header, so the leading H1 becomes a *higher*
 * heading level nested under a lower one (malformed hierarchy) and repeats
 * the same title twice, for free tokens on every turn. Strip it here, once,
 * so the 29 source files keep their own title for anyone reading them
 * standalone, while every injected copy stays clean.
 */
function stripRedundantTitle(body: string): string {
    // Bodies carry a leading blank line from the frontmatter's closing "---",
    // so the H1 isn't at position 0 — allow leading whitespace before it.
    return body.replace(/^\s*# .+\n+/, "")
}

function toSkillDescriptor(doc: SkillDoc): SkillDescriptor {
    return {
        id: doc.id, name: doc.name, description: doc.description ?? "", category: doc.category,
        tools: doc.tools, triggers: doc.triggers, preferred_agents: doc.preferred_agents,
        body: stripRedundantTitle(doc.body), version: doc.version, version_num: doc.version_num, active: doc.active,
    }
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

/** Stopwords to filter out before BM25 query construction */
const STOPWORDS = new Set([
    "que", "con", "para", "por", "una", "uno", "los", "las", "del",
    "como", "esta", "esto", "ese", "eso", "the", "and", "for",
    "with", "this", "that", "have", "will", "also", "de", "en",
    "el", "la", "se", "su", "sus", "al", "es", "son", "pero",
    "más", "mas", "ya", "yo", "tu", "te", "ti", "mi", "me",
    "hola", "hi", "hello", "hey", "gracias", "thank", "please",
    "ok", "okay", "yes", "si", "no", "bien", "good", "great",
    "puedes", "necesito", "quiero", "puedes", "necesitás", "quieres",
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
 * 6. Hydrate skill details from HiveDB and return top MAX_SKILLS_PER_TURN
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
    const skillsCol = await col<SkillDoc>("skills")
    const calendarOperation = isCalendarOperation(userMessage)
    const allSkills = (await skillsCol.scan({}))
        .filter(e => e.doc.active && !(calendarOperation && e.doc.category === "cron"))
        .map(e => toSkillDescriptor(e.doc))

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

    // Step 5: Hydrate full skill details from HiveDB (already loaded above)
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
 * Load the skills that ride along with the minimal tool loadout.
 *
 * Derived, not listed: a skill qualifies when every tool it documents is in
 * MINIMAL_TOOLS (see minimal-loadout.ts). Any other skill reaches the agent
 * through discovery, which injects it together with the tools it teaches.
 */
export async function getMinimalSkills(): Promise<SkillDescriptor[]> {
    try {
        const skillsCol = await col<SkillDoc>("skills")
        const skills = (await skillsCol.scan({}))
            .filter(e => e.doc.active && isMinimalSkill(e.doc.tools))
            .map(e => toSkillDescriptor(e.doc))

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
export async function syncSkillsToIndex(): Promise<void> {
    try {
        // Step 1: Get all enabled skills from database
        const skillsCol = await col<SkillDoc>("skills")
        const dbSkills = (await skillsCol.scan({})).map(e => e.doc).filter(s => s.active)

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
// ─── Debug/Test Helpers ─────────────────────────────────────────────────────

/**
 * Get all enabled skills from database (for debugging/testing)
 */
export async function getAllSkillsFromDB(): Promise<SkillDescriptor[]> {
    try {
        const skillsCol = await col<SkillDoc>("skills")
        return (await skillsCol.scan({})).filter(e => e.doc.active).map(e => toSkillDescriptor(e.doc))
    } catch (err) {
        log.error(`[skill-selector] Failed to fetch skills:`, err)
        return []
    }
}

/**
 * Get skill by name
 */
export async function getSkillByName(name: string): Promise<SkillDescriptor | undefined> {
    try {
        const skillsCol = await col<SkillDoc>("skills")
        const entry = await skillsCol.get(name)
        return entry && entry.doc.active ? toSkillDescriptor(entry.doc) : undefined
    } catch (err) {
        log.error(`[skill-selector] Failed to fetch skill by name:`, err)
        return undefined
    }
}

/**
 * Get skills by category
 */
export async function getSkillsByCategory(category: string): Promise<SkillDescriptor[]> {
    try {
        const skillsCol = await col<SkillDoc>("skills")
        const entries = await skillsCol.findBy("category", category)
        return entries.filter(e => e.doc.active).map(e => toSkillDescriptor(e.doc))
    } catch (err) {
        log.error(`[skill-selector] Failed to fetch skills by category:`, err)
        return []
    }
}
