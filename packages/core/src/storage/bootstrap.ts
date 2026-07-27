/**
 * HiveDB bootstrap — replaces initializeDatabase() + seedAllData() +
 * runStartupMigrations().
 *
 * A brand-new install never has legacy SQLite data to migrate, so there is
 * no version-gated migration list: ensureHiveDb() just makes sure every
 * collection's secondary indexes exist (idempotent, safe every boot) and
 * that the static catalogs are (re)seeded from their canonical source
 * (SEED_DATA / SkillLoader) — same "reseed every boot so code changes
 * always take effect" behavior `seedAllData()` had, just via `put()`
 * instead of `DELETE`+`INSERT`.
 */

import { getHiveDb } from "./hivedb";
import { col } from "./hive";
import { seedAllData } from "./seed";

interface IndexSpec {
  collection: string;
  field: string;
  unique?: boolean;
}

/**
 * Every equality index used by `findBy()` across the codebase. Grouped by
 * the migration stage that introduces the collection; kept in one place so
 * a missing index is a loud error (`findBy` throws) rather than a silent
 * empty result.
 */
const INDEXES: IndexSpec[] = [
  // Stage 1 — identity/config core
  { collection: "models", field: "provider_id" },
  { collection: "models", field: "model_type" },
  { collection: "agents", field: "user_id" },
  { collection: "agents", field: "model_id" },
  { collection: "agents", field: "parent_id" },
  { collection: "agents", field: "role" },
  { collection: "agents", field: "status" },
  { collection: "agents", field: "source" },
  // Stage 2 — catalog
  { collection: "channels", field: "user_id" },
  { collection: "channels", field: "type" },
  { collection: "skills", field: "category" },
  { collection: "skills", field: "active" },
  { collection: "tools", field: "category" },
  { collection: "tools", field: "active" },
  { collection: "ethics", field: "active" },
  { collection: "mcpTools", field: "server_id" },
  { collection: "mcpTools", field: "active" },
  // Stage 3 — auth/identity
  { collection: "userChannels", field: "channel" },
  { collection: "refreshTokens", field: "token_hash", unique: true },
  { collection: "refreshTokens", field: "user_id" },
  { collection: "notifications", field: "user_id" },
  { collection: "notifications", field: "channel" },
  // Stage 4 — chat/ACE
  { collection: "traces", field: "thread_id" },
  { collection: "traces", field: "agent_id" },
  { collection: "traces", field: "success" },
  { collection: "playbook", field: "active" },
  { collection: "playbook", field: "category" },
  // Stage 5 — scheduler
  { collection: "cronJobs", field: "status" },
  { collection: "cronJobs", field: "task_type" },
  { collection: "cronJobs", field: "agent_id" },
  { collection: "agentRuns", field: "status" },
  { collection: "agentRuns", field: "thread_id" },
  { collection: "agentRuns", field: "agent_id" },
  { collection: "agentRuns", field: "kind" },
  { collection: "agentRuns", field: "catalog_agent_id" },
  { collection: "jobQueue", field: "status" },
  { collection: "jobQueue", field: "lane" },
  { collection: "jobQueue", field: "type" },
  { collection: "jobQueue", field: "run_id" },
  { collection: "jobQueue", field: "idempotency_key" },
  { collection: "proofPackets", field: "run_id" },
  { collection: "proofPackets", field: "agent_id" },
  { collection: "proofPackets", field: "catalog_agent_id" },
  { collection: "artifacts", field: "run_id" },
  { collection: "artifacts", field: "task_id" },
  { collection: "artifacts", field: "user_id" },
  { collection: "artifacts", field: "status" },
  { collection: "verifications", field: "run_id" },
  { collection: "verifications", field: "task_id" },
  { collection: "verifications", field: "executor_agent_id" },
  { collection: "verifications", field: "status" },
  { collection: "agentProposals", field: "agent_id" },
  { collection: "agentProposals", field: "status" },
  { collection: "agentProposals", field: "type" },
  // Stage 6 — orchestration
  { collection: "tasks", field: "agent_id" },
  { collection: "tasks", field: "status" },
  { collection: "tasks", field: "catalog_agent_id" },
  { collection: "tasks", field: "delegation_group_id" },
  { collection: "delegationGroups", field: "turn_id", unique: true },
  { collection: "delegationGroups", field: "thread_id" },
  { collection: "delegationGroups", field: "status" },
  { collection: "agentBusMessages", field: "to_worker_id" },
  { collection: "agentBusMessages", field: "from_worker_id" },
  { collection: "agentBusMessages", field: "event_type" },
  { collection: "narrationEvents", field: "turn_id" },
  { collection: "narrationEvents", field: "thread_id" },
  { collection: "narrationEvents", field: "user_id" },
  { collection: "narrationEvents", field: "kind" },
  // Stage 7 — meeting
  { collection: "meetingSessions", field: "user_id" },
  { collection: "meetingSessions", field: "status" },
];

async function ensureIndexes(): Promise<void> {
  for (const spec of INDEXES) {
    const c = await col(spec.collection);
    await c.createIndex(spec.field, { unique: spec.unique });
  }
}

/**
 * Seeds the static catalogs (tools, skills, providers, models, mcp servers,
 * channels, ethics, ACE playbook) from their canonical source every boot —
 * same "reseed every boot so code changes always take effect" behavior the
 * old SQLite seedAllData() had. Fully idempotent: uses putIfAbsent for
 * user-toggleable fields (enabled/active) and doesn't touch `users`, so it's
 * safe to call unconditionally before any onboarding has happened.
 */
async function ensureSeedData(): Promise<void> {
  await seedAllData();
}

let bootstrapped = false;

/**
 * Idempotent entry point: opens the database, ensures indexes, reseeds the
 * static catalogs, and records the schema version. Safe to call on every
 * gateway boot.
 */
export async function ensureHiveDb(): Promise<void> {
  await getHiveDb();
  await ensureIndexes();
  await ensureSeedData();

  const meta = await col<{ value: number }>("meta");
  const existing = await meta.get("schemaVersion");
  if (!existing) await meta.put("schemaVersion", { value: 1 }, { expectedVersion: 0 });

  bootstrapped = true;
}

export function isBootstrapped(): boolean {
  return bootstrapped;
}
