/**
 * Regression guard: every bundled SKILL.md self-titles with a leading H1
 * right after its frontmatter (e.g. "# Canvas Report Skill") for standalone
 * readability, but every system-prompt injection site wraps skill.body with
 * its own "## <skill.name>" header — so the un-stripped leading H1 becomes a
 * higher heading level nested under a lower one (malformed hierarchy) and
 * repeats the same title twice, wasting tokens on every coordinator turn.
 * toSkillDescriptor() in skill-selector.ts strips it once at the source so
 * every consumer (context-compiler.ts, agent-loop.ts's dynamic injection)
 * gets a clean body automatically.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId } from "../packages/core/src/storage/boot-id";
import { getMinimalSkills } from "../packages/core/src/agent/skill-selector";

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

describe("skill-selector: redundant leading title stripped from skill.body", () => {
  test("none of the minimal (always-loaded) skills' bodies start with a leading H1", async () => {
    const skills = await getMinimalSkills();
    expect(skills.length).toBeGreaterThan(0);

    for (const skill of skills) {
      expect(skill.body.startsWith("# ")).toBe(false);
    }
  });
});
