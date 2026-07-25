/**
 * The coordinator starts every turn with MINIMAL_TOOLS and the skills derived
 * from it. Everything else is discovered, and discovery injects a tool together
 * with the skills that document it (agent-loop.ts).
 *
 * So an always-injected skill that teaches a tool outside the loadout is pure
 * cost: the agent reads instructions for something it cannot call, and gets the
 * same skill again later when it discovers the tool. That is exactly what had
 * drifted — 3 of the 4 hand-listed "minimal" skills were in that state — hence
 * the derivation in minimal-loadout.ts and this test.
 *
 * Uses HIVE_DB_PATH=":memory:".
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { createAllTools } from "../packages/core/src/tools/index";
import { getMinimalSkills } from "../packages/core/src/agent/skill-selector";
import {
  MINIMAL_TOOLS,
  isMinimalSkill,
  parseSkillTools,
} from "../packages/core/src/agent/minimal-loadout";

beforeAll(async () => {
  closeHiveDb();
  await ensureHiveDb();
});

afterAll(() => {
  closeHiveDb();
});

describe("minimal loadout", () => {
  test("every minimal tool is a real executor", () => {
    const executors = new Set(createAllTools({ tools: {} } as never).map((t) => t.name));
    const missing = [...MINIMAL_TOOLS].filter((name) => !executors.has(name)).sort();
    expect(missing).toEqual([]);
  });

  test("no minimal skill teaches a tool outside the loadout", async () => {
    const offenders = (await getMinimalSkills())
      .map((skill) => ({
        name: skill.name,
        outside: parseSkillTools(skill.tools).filter((t) => !MINIMAL_TOOLS.has(t)),
      }))
      .filter((s) => s.outside.length > 0);
    expect(offenders).toEqual([]);
  });

  test("the derivation actually selects something", async () => {
    const names = (await getMinimalSkills()).map((s) => s.name);
    // capability_discovery documents search_knowledge and nothing else, so it
    // qualifies by construction. If this ever empties out, the loadout and the
    // bundled skills have drifted apart again.
    expect(names).toContain("capability_discovery");
  });

  test("the rule rejects skills that reach outside the loadout", () => {
    expect(isMinimalSkill("search_knowledge")).toBe(true);
    expect(isMinimalSkill("task_delegate, agent_find, task_status")).toBe(true);
    expect(isMinimalSkill("search_knowledge, memory_write")).toBe(false);
    expect(isMinimalSkill("a2ui_create_surface")).toBe(false);
    expect(isMinimalSkill("")).toBe(false); // no anchor to the loadout
  });

  test("skills left out still reach the agent through discovery", async () => {
    // They are not lost, just not always-on: agent-loop injects a skill when
    // search_knowledge surfaces any tool the skill declares.
    const minimal = new Set((await getMinimalSkills()).map((s) => s.name));
    expect(minimal.has("memory_manager")).toBe(false);
    expect(minimal.has("a2ui_dashboard")).toBe(false);
    expect(minimal.has("task_orchestrator")).toBe(false);
  });
});
