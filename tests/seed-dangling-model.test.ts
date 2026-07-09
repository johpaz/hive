/**
 * seedAllData() unlinks dangling agent.model_id references
 *
 * Every boot, seedAllData() re-seeds the `models` collection from
 * SEED_DATA.models. If a model an agent was using drops out of the catalog
 * between versions (e.g. the HiveAgents GGUF consolidation in v0.0.41), the
 * agent must not keep a dangling model_id — it should fall back to
 * getDefaultLLM() at runtime instead.
 *
 * Uses an in-memory HiveDB instance (HIVE_DB_PATH=":memory:") so no state
 * persists between runs.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeAll } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { col, toIndexable, fromIndexable } from "../packages/core/src/storage/hive";
import { seedAllData } from "../packages/core/src/storage/seed";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import type { AgentDoc } from "../packages/core/src/storage/collections";

beforeAll(async () => {
  closeHiveDb();
  await ensureHiveDb();
});

describe("seedAllData: dangling model_id cleanup", () => {
  test("unlinks an agent's model_id when that model drops out of the catalog on re-seed", async () => {
    const modelsCol = await col<any>("models");
    const agentsCol = await col<AgentDoc>("agents");

    await modelsCol.put("deprecated-model-xyz", {
      id: "deprecated-model-xyz", provider_id: "hiveagents", name: "old variant",
      model_type: "llm", context_window: 0, capabilities: null, enabled: true, active: false,
    });
    await agentsCol.put("a-seed-test", {
      id: "a-seed-test", user_id: "u-seed-test", name: "Test Agent", description: null,
      system_prompt: null, tone: null, role: "coordinator", status: "idle", enabled: true,
      provider_id: toIndexable("hiveagents"), model_id: toIndexable("deprecated-model-xyz"),
      tools_json: null, skills_json: null, parent_id: toIndexable(null), max_iterations: 10,
      workspace: null, lastTraceAt: null, created_at: Date.now(), updated_at: Date.now(),
    });

    await seedAllData(); // deprecated-model-xyz isn't in SEED_DATA.models — gets dropped

    const entry = await agentsCol.get("a-seed-test");
    expect(fromIndexable(entry!.doc.model_id)).toBeNull();
    expect(fromIndexable(entry!.doc.provider_id)).toBe("hiveagents"); // still a valid provider — must survive
  });

  test("does not touch agents whose model is still in the catalog", async () => {
    const modelsCol = await col<any>("models");
    const agentsCol = await col<AgentDoc>("agents");

    const stillValidModel = (await modelsCol.scan({ limit: 1 }))[0];

    await agentsCol.put("a-seed-test-2", {
      id: "a-seed-test-2", user_id: "u-seed-test", name: "Test Agent 2", description: null,
      system_prompt: null, tone: null, role: "coordinator", status: "idle", enabled: true,
      provider_id: toIndexable(null), model_id: toIndexable(stillValidModel.id),
      tools_json: null, skills_json: null, parent_id: toIndexable(null), max_iterations: 10,
      workspace: null, lastTraceAt: null, created_at: Date.now(), updated_at: Date.now(),
    });

    await seedAllData();

    const entry = await agentsCol.get("a-seed-test-2");
    expect(fromIndexable(entry!.doc.model_id)).toBe(stillValidModel.id);
  });
});
