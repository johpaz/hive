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
  // Stage 6 — orchestration
  { collection: "projects", field: "user_id" },
  { collection: "projects", field: "agent_id" },
  { collection: "projects", field: "status" },
  { collection: "projects", field: "parent_id" },
  { collection: "tasks", field: "project_id" },
  { collection: "tasks", field: "agent_id" },
  { collection: "tasks", field: "status" },
  { collection: "agentBusMessages", field: "to_worker_id" },
  { collection: "agentBusMessages", field: "from_worker_id" },
  { collection: "agentBusMessages", field: "event_type" },
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
 * Seeds the static catalogs. Populated stage-by-stage as each collection's
 * write path lands (Stage 1 fills in users/providers/models; Stage 2 adds
 * channels/skills/tools/ethics/mcp; ...). Empty for now.
 */
async function ensureSeedData(): Promise<void> {
  // Filled in during Stage 1+ (see storage/seed.ts).
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
