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
import type {
  ReflectionDoc,
  PlaybookDoc,
  AgentDoc,
  CursorDoc,
  AgentProposalDoc,
  TraceDoc,
} from "../storage/collections"

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
    // Catalog personas are excluded: they are permanent capabilities, and they
    // are seeded with lastTraceAt=null (which reads as epoch 0), so inactivity
    // archiving would file every unused one away on its first run.
    const staleWorkers = allAgents.filter(e =>
      e.doc.role === "worker" &&
      e.doc.source !== "catalog" &&
      e.doc.status !== "archived" &&
      e.doc.enabled &&
      (e.doc.lastTraceAt ?? 0) < cutoff
    )

    for (const worker of staleWorkers) {
      await agentsCol.put(worker.id, { ...worker.doc, status: "archived", enabled: false, updated_at: Date.now() }, { expectedVersion: worker.version })

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

    await curateAgentStructure()

    log.info("[curator] Playbook updated")
  } catch (err) {
    log.warn("[curator] Error:", err)
  }
}

async function curateAgentStructure(): Promise<void> {
  const agentsCol = await col<AgentDoc>("agents")
  const proposalsCol = await col<AgentProposalDoc>("agentProposals")
  const tracesCol = await col<TraceDoc>("traces")
  const now = Date.now()

  // A catalog agent is a capability, not a disposable worker: disabling
  // `workspace_file_operator` takes filesystem work away from the whole hive
  // and nothing replaces it, so a bad streak can never switch one off by
  // itself. It raises a proposal for a human to decide instead — and the ACE
  // counters keep accumulating either way, so routing still sees the signal.
  for (const entry of await agentsCol.findBy("source", "catalog")) {
    if (!entry.doc.enabled) continue
    const helpful = entry.doc.helpful_count ?? 0
    const harmful = entry.doc.harmful_count ?? 0
    if (harmful > helpful && harmful >= MAX_HARMFUL_BEFORE_PRUNE) {
      await ensureAgentProposal(proposalsCol, {
        type: "disable_agent",
        agentId: entry.id,
        change: { active: false, reason: "harmful_count exceeded helpful_count" },
        evidence: [],
        confidence: 1,
      })
      log.warn(`[curator] Catalog agent '${entry.doc.name}' (${entry.id}) is failing verification (helpful=${helpful}, harmful=${harmful}) — proposed for review, left enabled`)
    }
  }

  const traces = (await tracesCol.scan({})).map((entry) => entry.doc)
  const agents = new Map((await agentsCol.scan({})).map((entry) => [entry.id, entry.doc]))

  // Recurrent successful free workers are candidates for a learned template.
  const freeSuccess = new Map<string, TraceDoc[]>()
  for (const trace of traces) {
    const agent = agents.get(trace.agent_id)
    if (!trace.success || trace.tool_used || trace.catalog_agent_id || agent?.role !== "worker" || agent.source === "catalog") continue
    const bucket = freeSuccess.get(trace.agent_id) ?? []
    bucket.push(trace)
    freeSuccess.set(trace.agent_id, bucket)
  }
  for (const [agentId, evidence] of freeSuccess) {
    if (evidence.length < 5) continue
    const agent = agents.get(agentId)!
    await ensureAgentProposal(proposalsCol, {
      type: "create_agent",
      agentId: `candidate:${agentId}`,
      change: {
        suggested_name: agent.name,
        suggested_description: agent.description,
        observed_tasks: evidence.slice(-5).map((trace) => trace.input_summary),
      },
      evidence: evidence.slice(-5).map((trace) => trace.id),
      confidence: Math.min(0.95, 0.5 + evidence.length * 0.05),
    })
  }

  // Repeated failures identify a loadout mismatch. This remains a proposal;
  // permissions are never changed automatically.
  const failures = new Map<string, TraceDoc[]>()
  for (const trace of traces) {
    if (trace.success || !trace.catalog_agent_id || !trace.tool_used) continue
    const key = `${trace.catalog_agent_id}\0${trace.tool_used}`
    const bucket = failures.get(key) ?? []
    bucket.push(trace)
    failures.set(key, bucket)
  }
  for (const [key, evidence] of failures) {
    if (evidence.length < 3) continue
    const [agentId, tool] = key.split("\0")
    await ensureAgentProposal(proposalsCol, {
      type: "move_tool",
      agentId,
      change: { tool, reason: "repeated failures; review ownership or remove from loadout" },
      evidence: evidence.slice(-10).map((trace) => trace.id),
      confidence: Math.min(0.95, 0.55 + evidence.length * 0.05),
    })
  }

  const { syncCatalogAgentsToIndex } = await import("./catalog-selector")
  await syncCatalogAgentsToIndex()
}

async function ensureAgentProposal(
  proposalsCol: Awaited<ReturnType<typeof col<AgentProposalDoc>>>,
  input: {
    type: AgentProposalDoc["type"]
    agentId: string
    change: unknown
    evidence: string[]
    confidence: number
  },
): Promise<void> {
  const existing = (await proposalsCol.findBy("agent_id", input.agentId))
    .find((entry) => entry.doc.type === input.type && entry.doc.status === "proposed")
  if (existing) return
  const id = await nextId("agentProposals")
  const now = Date.now()
  await proposalsCol.put(id, {
    id,
    type: input.type,
    agent_id: input.agentId,
    proposed_change_json: JSON.stringify(input.change),
    evidence_trace_ids_json: JSON.stringify(input.evidence),
    confidence: input.confidence,
    status: "proposed",
    created_at: now,
    updated_at: now,
  }, { expectedVersion: 0 })
}

// ─── Process a single reflection ─────────────────────────────────────────────

async function processReflection(
  playbookCol: Awaited<ReturnType<typeof col<PlaybookDoc>>>,
  allPlaybook: Array<{ id: string; version: number; doc: PlaybookDoc }>,
  reflection: ReflectionDoc
): Promise<void> {
  const category = mapInsightTypeToCategory(reflection.insight_type)
  const applicable: string[] = reflection.affected_tools ? JSON.parse(reflection.affected_tools) : []
  if (reflection.affected_agents) {
    const agentsCol = await col<AgentDoc>("agents")
    for (const agentId of JSON.parse(reflection.affected_agents) as string[]) {
      const agent = await agentsCol.get(agentId)
      if (agent?.doc.source === "catalog") applicable.push(`agent:${agent.doc.id}`)
    }
  }
  const applicableTo = applicable.length ? JSON.stringify([...new Set(applicable)]) : null

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
    applicable_to: applicableTo,
    helpful_count: 1,
    harmful_count: 0,
    active: true,
    source_reflection_id: toIndexable(reflection.id),
    created_at: now,
    updated_at: now,
  }, { expectedVersion: 0 })
  allPlaybook.push({ id, version: 1, doc: { id, rule: reflection.description, category, applicable_to: applicableTo, helpful_count: 1, harmful_count: 0, active: true, source_reflection_id: toIndexable(reflection.id), created_at: now, updated_at: now } })
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
