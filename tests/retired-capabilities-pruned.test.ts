/**
 * Seeding is put-in-place with natural ids, so dropping a tool from SEED_DATA
 * or deleting a bundled SKILL.md does NOT remove the row an older install
 * already wrote — and a stale row stays discoverable through search_knowledge
 * while its executor no longer exists. `pruneRetired()` in seed.ts closes that
 * gap; this test simulates the upgrade path it exists for.
 *
 * Uses HIVE_DB_PATH=":memory:".
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { seedAllData } from "../packages/core/src/storage/seed";
import { col } from "../packages/core/src/storage/hive";
import { createAllTools } from "../packages/core/src/tools/index";
import { syncToolsToIndex, syncSkillsToIndex } from "../packages/core/src/agent/context-compiler";
import { searchCapabilities } from "../packages/core/src/agent/capability-search";
import type { AgentDoc, ToolDoc, SkillDoc } from "../packages/core/src/storage/collections";

const RETIRED_TOOL = "task_delegate_code";
const RETIRED_SKILL = "code_delegator";
/** Projects/DAG: withdrawn when this instance stopped managing projects. */
const RETIRED_PROJECT_TOOLS = ["project_create", "project_status", "task_create", "task_complete"];
const RETIRED_CANVAS_TOOLS = [
  "canvas_render",
  "canvas_ask",
  "canvas_confirm",
  "canvas_show_card",
  "canvas_show_progress",
  "canvas_show_list",
  "canvas_clear",
];
const RETIRED_CANVAS_SKILLS = ["canvas_report", "canvas_dashboard", "canvas_interact"];
const RETIRED_CANVAS_AGENT = "canvas_presenter";

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

/** Recreates what a pre-upgrade install has sitting in its DB. */
async function writeLegacyRows(): Promise<void> {
  const now = Date.now();
  const toolsCol = await col<ToolDoc>("tools");
  for (const id of [RETIRED_TOOL, ...RETIRED_CANVAS_TOOLS]) {
    await toolsCol.put(id, {
      id,
      name: id,
      description: `Legacy capability ${id}`,
      category: id.startsWith("canvas_") ? "canvas" : "agents",
      enabled: true,
      active: true,
      created_at: now,
      updated_at: now,
    });
  }

  const skillsCol = await col<SkillDoc>("skills");
  for (const id of [RETIRED_SKILL, ...RETIRED_CANVAS_SKILLS]) {
    await skillsCol.put(id, {
      id,
      name: id,
      description: `Legacy skill ${id}`,
      version: "1.0.0",
      author: "Hive Team",
      icon: "🧹",
      category: id.startsWith("canvas_") ? "canvas" : "agents",
      permissions: "[]",
      dependencies: "[]",
      tools: id.startsWith("canvas_") ? "canvas_render" : "task_delegate_code",
      triggers: id,
      preferred_agents: "[]",
      body: `# ${id}`,
      version_num: 1,
      active: true,
      created_at: now,
      updated_at: now,
    });
  }

  const agentsCol = await col<AgentDoc>("agents");
  const template = (await agentsCol.get("workspace_file_operator"))!.doc;
  await agentsCol.put(RETIRED_CANVAS_AGENT, {
    ...template,
    id: RETIRED_CANVAS_AGENT,
    name: "Presentador Canvas",
    source: "catalog",
  });
}

describe("retired Code Bridge capabilities", () => {
  test("a fresh seed never creates them", async () => {
    expect(await (await col<ToolDoc>("tools")).get(RETIRED_TOOL)).toBeUndefined();
    expect(await (await col<SkillDoc>("skills")).get(RETIRED_SKILL)).toBeUndefined();
    for (const id of RETIRED_CANVAS_TOOLS) {
      expect(await (await col<ToolDoc>("tools")).get(id)).toBeUndefined();
    }
    for (const id of RETIRED_CANVAS_SKILLS) {
      expect(await (await col<SkillDoc>("skills")).get(id)).toBeUndefined();
    }
    expect(await (await col<AgentDoc>("agents")).get(RETIRED_CANVAS_AGENT)).toBeUndefined();
  });

  test("rows left by an older install are deleted on the next boot", async () => {
    await writeLegacyRows();
    expect(await (await col<ToolDoc>("tools")).get(RETIRED_TOOL)).toBeTruthy();
    expect(await (await col<SkillDoc>("skills")).get(RETIRED_SKILL)).toBeTruthy();
    expect(await (await col<AgentDoc>("agents")).get(RETIRED_CANVAS_AGENT)).toBeTruthy();

    await seedAllData(); // what ensureHiveDb() runs on every boot

    expect(await (await col<ToolDoc>("tools")).get(RETIRED_TOOL)).toBeUndefined();
    expect(await (await col<SkillDoc>("skills")).get(RETIRED_SKILL)).toBeUndefined();
    for (const id of RETIRED_CANVAS_TOOLS) {
      expect(await (await col<ToolDoc>("tools")).get(id)).toBeUndefined();
    }
    for (const id of RETIRED_CANVAS_SKILLS) {
      expect(await (await col<SkillDoc>("skills")).get(id)).toBeUndefined();
    }
    expect(await (await col<AgentDoc>("agents")).get(RETIRED_CANVAS_AGENT)).toBeUndefined();
  });

  test("pruning leaves the surviving catalog intact", async () => {
    await writeLegacyRows();
    await seedAllData();

    const tools = (await (await col<ToolDoc>("tools")).scan({})).map((e) => e.doc.name);
    expect(tools).toContain("task_delegate");
    expect(tools).toContain("task_status");

    const skills = (await (await col<SkillDoc>("skills")).scan({})).map((e) => e.doc.name);
    expect(skills).toContain("task_orchestrator");
    expect(skills).toContain("agent_spawner");
  });

  test("project/DAG rows from an older install are deleted too", async () => {
    const toolsCol = await col<ToolDoc>("tools");
    const now = Date.now();
    for (const id of RETIRED_PROJECT_TOOLS) {
      await toolsCol.put(id, {
        id, name: id, description: `Legacy project tool ${id}`, category: "projects",
        enabled: true, active: true, created_at: now, updated_at: now,
      });
    }
    for (const id of RETIRED_PROJECT_TOOLS) expect(await toolsCol.get(id)).toBeTruthy();

    await seedAllData();

    for (const id of RETIRED_PROJECT_TOOLS) expect(await toolsCol.get(id)).toBeUndefined();
  });

  test("no executor is registered for the retired tool", () => {
    const names = createAllTools({ tools: {} } as never).map((t) => t.name);
    expect(names).not.toContain(RETIRED_TOOL);
    for (const id of RETIRED_PROJECT_TOOLS) expect(names).not.toContain(id);
    for (const id of RETIRED_CANVAS_TOOLS) expect(names).not.toContain(id);
    expect(names).toContain("task_delegate");
    expect(names).toContain("a2ui_create_surface");
  });

  // Deleting the row is only half the job: search_knowledge queries the
  // capability index, so an entry indexed before the upgrade must not survive
  // the re-sync — otherwise the agent still discovers a tool with no executor.
  test("search_knowledge can no longer discover them after the upgrade", async () => {
    await writeLegacyRows();
    await syncToolsToIndex();
    await syncSkillsToIndex();

    const stale = await searchCapabilities("code bridge subagente CLI", { types: ["tool", "skill"], k: 25 });
    expect(stale.map((hit) => hit.rawId)).toContain(RETIRED_TOOL);

    await seedAllData();   // prunes the rows
    await syncToolsToIndex(); // full replace per type
    await syncSkillsToIndex();

    const fresh = await searchCapabilities("code bridge subagente CLI", { types: ["tool", "skill"], k: 25 });
    const ids = fresh.map((hit) => hit.rawId);
    expect(ids).not.toContain(RETIRED_TOOL);
    expect(ids).not.toContain(RETIRED_SKILL);

    // The index is still populated — the replace didn't just empty it.
    const alive = await searchCapabilities("delegar tarea agente", { types: ["tool"], k: 25 });
    expect(alive.map((hit) => hit.rawId)).toContain("task_delegate");
  });
});
