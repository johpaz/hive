/**
 * seedAllData() unlinks dangling agent.model_id references
 *
 * Every boot, seedAllData() wipes and re-inserts the `models` table from
 * SEED_DATA.models with foreign_keys OFF (so the delete isn't blocked by
 * agents pointing at those rows). If a model an agent was using drops out
 * of the catalog between versions (e.g. the HiveAgents GGUF consolidation
 * in v0.0.41), the agent must not keep a dangling model_id — it should
 * fall back to getDefaultLLM() at runtime instead.
 *
 * Runs against an isolated HIVE_HOME so it never touches a real ~/.hive.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testHome = mkdtempSync(join(tmpdir(), "hive-seed-test-"));
process.env.HIVE_HOME = testHome;
process.env.HIVE_SEARCH_DB_PATH = ":memory:";

import { initializeDatabase, getDb } from "../packages/core/src/storage/sqlite";
import { seedAllData } from "../packages/core/src/storage/seed";

beforeAll(() => {
  initializeDatabase();
  seedAllData();
});

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
});

describe("seedAllData: dangling model_id cleanup", () => {
  test("unlinks an agent's model_id when that model drops out of the catalog on re-seed", () => {
    const db = getDb();

    db.query(`INSERT INTO users (id, email) VALUES ('u-seed-test', 'seed-test@test.com')`).run();
    db.query(`
      INSERT INTO models (id, provider_id, name, model_type, enabled, active)
      VALUES ('deprecated-model-xyz', 'hiveagents', 'old variant', 'llm', 1, 0)
    `).run();
    db.query(`
      INSERT INTO agents (id, user_id, name, role, provider_id, model_id)
      VALUES ('a-seed-test', 'u-seed-test', 'Test Agent', 'coordinator', 'hiveagents', 'deprecated-model-xyz')
    `).run();

    seedAllData(); // deprecated-model-xyz isn't in SEED_DATA.models — gets dropped

    const row = db.query(`SELECT model_id, provider_id FROM agents WHERE id = 'a-seed-test'`).get() as
      { model_id: string | null; provider_id: string | null };

    expect(row.model_id).toBeNull();
    expect(row.provider_id).toBe("hiveagents"); // still a valid provider — must survive
  });

  test("does not touch agents whose model is still in the catalog", () => {
    const db = getDb();
    const stillValidModel = db.query(`SELECT id FROM models LIMIT 1`).get() as { id: string };

    db.query(`
      INSERT INTO agents (id, user_id, name, role, provider_id, model_id)
      VALUES ('a-seed-test-2', 'u-seed-test', 'Test Agent 2', 'coordinator', NULL, ?)
    `).run(stillValidModel.id);

    seedAllData();

    const row = db.query(`SELECT model_id FROM agents WHERE id = 'a-seed-test-2'`).get() as { model_id: string };
    expect(row.model_id).toBe(stillValidModel.id);
  });
});
