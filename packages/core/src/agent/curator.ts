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
 *
 * "Last processed reflection" is tracked via a `cursors` collection doc
 * (id="curator:lastReflection") instead of SQL's MAX(source_reflection_id).
 * Stale-worker detection uses the denormalized `agents.lastTraceAt` field
 * (set by tracer.ts) instead of a correlated MAX(t.created_at) subquery.
 */

import { logger } from "../utils/logger"
import { col, nextId, toIndexable, fromIndexable } from "../storage/hive"
import type { ReflectionDoc, PlaybookDoc, AgentDoc, CursorDoc } from "../storage/collections"

const log = logger.child("curator")

const DAYS_BEFORE_ARCHIVE = 14   // archive workers not used in N days
const MAX_HARMFUL_BEFORE_PRUNE = 3
const CURSOR_ID = "curator:lastReflection"

/** Entry point — called by reflector.ts after it inserts new reflections */
export async function runCurator(): Promise<void> {
  try {
    const cursorsCol = await col<CursorDoc>("cursors")
    const playbookCol = await col<PlaybookDoc>("playbook")
    const reflectionsCol = await col<ReflectionDoc>("reflections")
    const agentsCol = await col<AgentDoc>("agents")

    // Process unprocessed reflections (those newer than last run)
    const cursorEntry = await cursorsCol.get(CURSOR_ID)
    const lastProcessed = cursorEntry?.doc.value ?? null

    let candidates = lastProcessed
      ? await reflectionsCol.scan({ start: lastProcessed })
      : await reflectionsCol.scan({})
    if (lastProcessed && candidates[0]?.id === lastProcessed) candidates = candidates.slice(1)

    if (candidates.length === 0) {
      log.debug("[curator] No new reflections to process")
    } else {
      log.info(`[curator] Processing ${candidates.length} new reflections`)
      const allPlaybook = await playbookCol.scan({})
      for (const entry of candidates) {
        await processReflection(playbookCol, allPlaybook, entry.doc)
      }
      const newCursor = candidates[candidates.length - 1].id
      await cursorsCol.put(CURSOR_ID, { value: newCursor }, cursorEntry ? { expectedVersion: cursorEntry.version } : { expectedVersion: 0 })
    }

    // Prune rules where harmful > helpful (consistently bad rules)
    const allActive = (await playbookCol.scan({})).filter(e => e.doc.active)
    for (const entry of allActive) {
      if (entry.doc.harmful_count > entry.doc.helpful_count && entry.doc.harmful_count >= MAX_HARMFUL_BEFORE_PRUNE) {
        await playbookCol.put(entry.id, { ...entry.doc, active: false, updated_at: Date.now() }, { expectedVersion: entry.version })
      }
    }

    // Archive unused workers — uses the denormalized lastTraceAt field
    // (set by tracer.ts) instead of a correlated MAX(created_at) subquery.
    const cutoff = Date.now() - (DAYS_BEFORE_ARCHIVE * 86400 * 1000)
    const allAgents = await agentsCol.scan({})
    const staleWorkers = allAgents.filter(e =>
      e.doc.role === "worker" &&
      e.doc.status !== "archived" &&
      e.doc.enabled &&
      (e.doc.lastTraceAt ?? 0) < cutoff
    )

    for (const worker of staleWorkers) {
      await agentsCol.put(worker.id, { ...worker.doc, status: "archived", updated_at: Date.now() }, { expectedVersion: worker.version })

      // Add playbook note about archival
      const currentPlaybook = await playbookCol.scan({})
      await addOrUpdateRule(playbookCol, currentPlaybook, {
        rule: `Worker '${worker.doc.name}' was archived due to inactivity (>${DAYS_BEFORE_ARCHIVE} days unused).`,
        category: "agent_creation",
        applicable_to: null,
        sourceReflectionId: null,
      })

      log.info(`[curator] Archived inactive worker: ${worker.doc.name} (${worker.id})`)
    }

    log.info("[curator] Playbook updated")
  } catch (err) {
    log.warn("[curator] Error:", err)
  }
}

// ─── Process a single reflection ─────────────────────────────────────────────

async function processReflection(
  playbookCol: Awaited<ReturnType<typeof col<PlaybookDoc>>>,
  allPlaybook: Array<{ id: string; version: number; doc: PlaybookDoc }>,
  reflection: ReflectionDoc
): Promise<void> {
  const category = mapInsightTypeToCategory(reflection.insight_type)

  // Check if a similar rule already exists (fuzzy check by first 60 chars)
  const prefix = reflection.description.substring(0, 60)
  const existing = allPlaybook.find(e => e.doc.active && e.doc.rule.startsWith(prefix))

  if (existing) {
    // Reinforce existing rule
    await playbookCol.put(existing.id, { ...existing.doc, helpful_count: existing.doc.helpful_count + 1, updated_at: Date.now() }, { expectedVersion: existing.version })
    return
  }

  // Insert new rule
  const id = await nextId("playbook")
  const now = Date.now()
  await playbookCol.put(id, {
    id,
    rule: reflection.description,
    category,
    applicable_to: reflection.affected_tools ? JSON.stringify(JSON.parse(reflection.affected_tools)) : null,
    helpful_count: 1,
    harmful_count: 0,
    active: true,
    source_reflection_id: toIndexable(reflection.id),
    created_at: now,
    updated_at: now,
  }, { expectedVersion: 0 })
  allPlaybook.push({ id, version: 1, doc: { id, rule: reflection.description, category, applicable_to: null, helpful_count: 1, harmful_count: 0, active: true, source_reflection_id: toIndexable(reflection.id), created_at: now, updated_at: now } })
}

function mapInsightTypeToCategory(
  type: string
): "tool_selection" | "response_quality" | "error_avoidance" | "optimization" | "agent_creation" {
  const map: Record<string, any> = {
    success_pattern: "tool_selection",
    failure_pattern: "error_avoidance",
    optimization: "optimization",
    ethics_violation: "error_avoidance",
    // G9 evaluateHarness() insights (reflector.ts's analyzeCausalThreads)
    root_cause: "error_avoidance",
    learning_proposal: "response_quality",
  }
  return map[type] ?? "optimization"
}

async function addOrUpdateRule(
  playbookCol: Awaited<ReturnType<typeof col<PlaybookDoc>>>,
  allPlaybook: Array<{ id: string; version: number; doc: PlaybookDoc }>,
  opts: {
    rule: string
    category: string
    applicable_to: string | null
    sourceReflectionId: string | null
  }
): Promise<void> {
  const prefix = opts.rule.substring(0, 60)
  const existing = allPlaybook.find(e => e.doc.rule.startsWith(prefix))

  if (existing) {
    await playbookCol.put(existing.id, { ...existing.doc, helpful_count: existing.doc.helpful_count + 1, updated_at: Date.now() }, { expectedVersion: existing.version })
  } else {
    const id = await nextId("playbook")
    const now = Date.now()
    await playbookCol.put(id, {
      id,
      rule: opts.rule,
      category: opts.category as PlaybookDoc["category"],
      applicable_to: opts.applicable_to,
      helpful_count: 1,
      harmful_count: 0,
      active: true,
      source_reflection_id: toIndexable(opts.sourceReflectionId),
      created_at: now,
      updated_at: now,
    }, { expectedVersion: 0 })
  }
}
