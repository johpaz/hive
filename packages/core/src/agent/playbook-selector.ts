/**
 * FTS5-based Playbook Rules Selector (ACE Curator)
 * 
 * This module allows the Context Compiler to inject relevant evolved rules
 * into the agent prompt based on semantic relevance to the current message.
 */

import { getDb } from "../storage/sqlite"
import { logger } from "../utils/logger"

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

/** Minimum bm25 score threshold for rules */
const MIN_RELEVANCE_THRESHOLD = -10 // Relaxed for better matching

// ─── Selection Logic ───────────────────────────────────────────────────────────

/**
 * Select relevant rules from the Playbook based on semantic matching
 */
export function selectPlaybookRules(message: string): PlaybookRule[] {
    const db = getDb()
    const startTime = performance.now()

    // Clean query — use prefix matching for consistency with skill-selector and tool-selector
    const keywords = message
        .toLowerCase()
        // Keep only letters, numbers, spaces (strips ALL FTS5 special syntax)
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(w => w.length > 3)
        .slice(0, 5)

    if (keywords.length === 0) return []

    // Use prefix matching for better recall (e.g., "program*" matches "programar", "programación")
    const ftsQuery = keywords.map(w => `${w}*`).join(" OR ")

    try {
        // Query FTS table
        const ftsResults = db.query(`
            SELECT rowid, bm25(playbook_fts) as score
            FROM playbook_fts
            WHERE playbook_fts MATCH ?
            ORDER BY score ASC
            LIMIT ?
        `).all(ftsQuery, MAX_RULES_PER_TURN) as Array<{ rowid: number; score: number }>

        const relevantIds = ftsResults
            .filter(r => r.score >= MIN_RELEVANCE_THRESHOLD)
            .map(r => r.rowid)

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
 * Sync active playbook rules to FTS5 virtual table
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

        // Step 2: Atomic transaction for FTS5 sync
        const syncTransaction = db.transaction(() => {
            // Verify table exists
            const tableCheck = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='playbook_fts'").get()
            if (!tableCheck) {
                throw new Error("playbook_fts table does not exist!")
            }

            // A: Clear existing data
            db.run("DELETE FROM playbook_fts")

            // B: Prepare insertion
            const insert = db.prepare(`
                INSERT INTO playbook_fts(rowid, rule, category, applicable_to)
                VALUES (?, ?, ?, ?)
            `)

            // C: Re-populate
            for (const item of rules) {
                insert.run(item.id, item.rule, item.category, item.applicable_to)
            }
        })

        // Execute transaction
        syncTransaction()

        log.info(`[playbook-selector] Atomic sync complete: ${rules.length} rules indexed in FTS5`)

    } catch (err) {
        log.error(`[playbook-selector] Transactional sync failed:`, err)
        throw err
    }
}
