/**
 * ACE Curator — converts reflections into playbook rules.
 *
 * Runs after the Reflector. Performs incremental edits to the playbook:
 *   - New insights → new rules
 *   - Repeated patterns → increment helpful_count
 *   - Contradicted rules → increment harmful_count or deactivate
 *   - Deactivate rules where harmful_count > helpful_count
 *   - Archive unused workers
 *
 * Never rewrites the whole playbook — only incremental edits.
 */

import { logger } from "../utils/logger"

const log = logger.child("curator")

const DAYS_BEFORE_ARCHIVE = 14   // archive workers not used in N days
const MAX_HARMFUL_BEFORE_PRUNE = 3

/** Entry point — called by reflector.ts after it inserts new reflections */
export async function runCurator(): Promise<void> {
  try {
    const { getDb } = await import("../storage/sqlite")
    const db = getDb()

    // Process unprocessed reflections (those newer than last run)
    const lastProcessed = (db.query<any, []>(
      "SELECT COALESCE(MAX(source_reflection_id), 0) as mid FROM playbook"
    ).get() as any)?.mid ?? 0

    const reflections = (db.query as any)(
      "SELECT * FROM reflections WHERE id > ? ORDER BY id ASC"
    ).all(lastProcessed)

    if (reflections.length === 0) {
      log.debug("[curator] No new reflections to process")
    } else {
      log.info(`[curator] Processing ${reflections.length} new reflections`)
      for (const reflection of reflections) {
        processReflection(db, reflection)
      }
    }

    // Prune rules where harmful > helpful (consistently bad rules)
    db.query(`
      UPDATE playbook
      SET active = 0, updated_at = unixepoch()
      WHERE active = 1
        AND harmful_count > helpful_count
        AND harmful_count >= ?
    `).run(MAX_HARMFUL_BEFORE_PRUNE)

    // Archive unused workers
    const cutoff = Math.floor(Date.now() / 1000) - (DAYS_BEFORE_ARCHIVE * 86400)
    const staleworkers = (db.query as any)(`
      SELECT a.id, a.name
      FROM agents a
      WHERE a.role = 'worker'
        AND a.status != 'archived'
        AND a.enabled = 1
        AND (
          SELECT MAX(t.created_at) FROM traces t WHERE t.agent_id = a.id
        ) < ?
    `).all(cutoff)

    for (const worker of staleworkers) {
      db.query(
        "UPDATE agents SET status = 'archived', updated_at = unixepoch() WHERE id = ?"
      ).run(worker.id)

      // Add playbook note about archival
      addOrUpdateRule(db, {
        rule: `Worker '${worker.name}' was archived due to inactivity (>${DAYS_BEFORE_ARCHIVE} days unused).`,
        category: "agent_creation",
        applicable_to: null,
        sourceReflectionId: null,
      })

      log.info(`[curator] Archived inactive worker: ${worker.name} (${worker.id})`)
    }

    log.info("[curator] Playbook updated")
  } catch (err) {
    log.warn("[curator] Error:", err)
  }
}

// ─── Process a single reflection ─────────────────────────────────────────────

function processReflection(db: any, reflection: any): void {
  const category = mapInsightTypeToCategory(reflection.insight_type)

  // Check if a similar rule already exists (fuzzy check by first 60 chars)
  const prefix = reflection.description.substring(0, 60)
  const existing = (db.query as any)(
    "SELECT id, helpful_count FROM playbook WHERE rule LIKE ? AND active = 1 LIMIT 1"
  ).get(`${prefix}%`)

  if (existing) {
    // Reinforce existing rule
    db.query(
      "UPDATE playbook SET helpful_count = helpful_count + 1, updated_at = unixepoch() WHERE id = ?"
    ).run(existing.id)
    return
  }

  // Insert new rule
  db.query(`
    INSERT INTO playbook (rule, category, applicable_to, helpful_count, source_reflection_id)
    VALUES (?, ?, ?, 1, ?)
  `).run(
    reflection.description,
    category,
    reflection.affected_tools
      ? JSON.stringify(JSON.parse(reflection.affected_tools))
      : null,
    reflection.id,
  )
}

function mapInsightTypeToCategory(
  type: string
): "tool_selection" | "response_quality" | "error_avoidance" | "optimization" | "agent_creation" {
  const map: Record<string, any> = {
    success_pattern: "tool_selection",
    failure_pattern: "error_avoidance",
    optimization: "optimization",
    ethics_violation: "error_avoidance",
  }
  return map[type] ?? "optimization"
}

function addOrUpdateRule(
  db: any,
  opts: {
    rule: string
    category: string
    applicable_to: string | null
    sourceReflectionId: number | null
  }
): void {
  const prefix = opts.rule.substring(0, 60)
  const existing = (db.query as any)(
    "SELECT id FROM playbook WHERE rule LIKE ? LIMIT 1"
  ).get(`${prefix}%`)

  if (existing) {
    db.query(
      "UPDATE playbook SET helpful_count = helpful_count + 1, updated_at = unixepoch() WHERE id = ?"
    ).run(existing.id)
  } else {
    db.query(`
      INSERT INTO playbook (rule, category, applicable_to, helpful_count, source_reflection_id)
      VALUES (?, ?, ?, 1, ?)
    `).run(opts.rule, opts.category, opts.applicable_to, opts.sourceReflectionId)
  }
}
