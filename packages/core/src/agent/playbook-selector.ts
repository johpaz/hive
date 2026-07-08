/**
 * HiveDB-based Playbook Rules Selector (ACE Curator)
 *
 * This module allows the Context Compiler to inject relevant evolved rules
 * into the agent prompt based on semantic relevance to the current message.
 * Search runs on the HiveDB capability index (Spanish stemming + accent
 * folding, lenient parsing — raw user text never throws).
 */

import { getDb } from "../storage/sqlite"
import { logger } from "../utils/logger"
import {
    searchCapabilities,
    applyRelativeCutoff,
    replaceCapabilityDocs,
    type CapabilityDoc,
} from "./capability-search"

const log = logger.child("playbook-selector")

// ─── Types ───────────────────────────────────────────────────────────────────────

export interface PlaybookRule {
    id: number
    rule: string
    category: string
    applicable_to?: string
}

// ─── Configuration ─────────────────────────────────────────────────────────────

/** Maximum rules to inject per context window */
const MAX_RULES_PER_TURN = 5

/**
 * Relative relevance cutoff: keep a hit only if it scores at least this
 * fraction of the top hit (HiveDB BM25 scores are positive, higher = better).
 */
const RELEVANCE_RATIO = 0.3

// ─── Selection Logic ───────────────────────────────────────────────────────────

/**
 * Select relevant rules from the Playbook based on semantic matching
 */
export async function selectPlaybookRules(message: string): Promise<PlaybookRule[]> {
    const db = getDb()
    const startTime = performance.now()

    if (!message.trim()) return []

    try {
        const hits = await searchCapabilities(message, {
            types: ["playbook"],
            k: MAX_RULES_PER_TURN,
        })

        const relevantIds = applyRelativeCutoff(hits, RELEVANCE_RATIO)
            .map(h => Number.parseInt(h.rawId, 10))
            .filter(id => Number.isFinite(id))

        if (relevantIds.length === 0) return []

        // Fetch full rules
        const rules = db.query(`
            SELECT id, rule, category, applicable_to
            FROM playbook
            WHERE id IN (${relevantIds.map(() => '?').join(',')})
            AND active = 1
        `).all(...relevantIds) as PlaybookRule[]

        const timing = performance.now() - startTime
        log.info(`[playbook-selector] Selected ${rules.length} rules in ${timing.toFixed(2)}ms`)
        if (rules.length > 0) {
          log.debug(`[playbook-selector] Rules: ${rules.map(r => `[${r.id}] ${r.rule.substring(0, 60)}`).join(', ')}`)
        }

        return rules
    } catch (err) {
        log.error(`[playbook-selector] Failed to select rules:`, err)
        return []
    }
}

// ─── Sync Logic ───────────────────────────────────────────────────────────────

/**
 * Sync active playbook rules to the HiveDB capability index.
 * Replaces all `type=playbook` documents atomically.
 */
export async function syncPlaybookToFTS(): Promise<void> {
    const db = getDb()

    try {
        // Step 1: Get active rules
        const rules = db.query(`
            SELECT id, rule, category, applicable_to
            FROM playbook
            WHERE active = 1
        `).all() as Array<{
            id: number
            rule: string
            category: string
            applicable_to: string
        }>

        if (rules.length === 0) {
            log.debug(`[playbook-selector] No rules in playbook to sync`)
        }

        // Step 2: Replace all playbook documents in the capability index
        const docs: CapabilityDoc[] = rules.map(item => ({
            type: "playbook" as const,
            rawId: String(item.id),
            body: item.rule,
            tags: [item.category, item.applicable_to].filter(Boolean).join(" "),
        }))

        await replaceCapabilityDocs("playbook", docs)

        log.info(`[playbook-selector] Sync complete: ${rules.length} rules indexed in HiveDB`)

    } catch (err) {
        log.error(`[playbook-selector] Playbook index sync failed:`, err)
        throw err
    }
}
