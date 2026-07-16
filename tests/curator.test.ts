/**
 * Curator tests: baseline regression coverage for the existing
 * reflection → playbook pipeline (none existed before), plus the new
 * category mapping for G9 evaluateHarness() insight types
 * (root_cause/learning_proposal — see reflector.ts's analyzeCausalThreads).
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId } from "../packages/core/src/storage/boot-id";
import { col, nextId } from "../packages/core/src/storage/hive";
import type { ReflectionDoc, PlaybookDoc } from "../packages/core/src/storage/collections";
import { runCurator } from "../packages/core/src/agent/curator";

async function seedReflection(overrides: Partial<ReflectionDoc>) {
  const reflectionsCol = await col<ReflectionDoc>("reflections");
  const id = await nextId("reflections");
  await reflectionsCol.put(id, {
    id,
    trace_ids: "[]",
    insight_type: "failure_pattern",
    description: "Tool 'flaky_tool' failed 5 times recently.",
    affected_tools: null,
    affected_agents: null,
    confidence: 0.5,
    created_at: Date.now(),
    ...overrides,
  });
  return id;
}

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

describe("curator: baseline reflection → playbook pipeline", () => {
  test("a new reflection creates a new active playbook rule", async () => {
    await seedReflection({ description: "Tool 'flaky_tool' failed 5 times recently." });

    await runCurator();

    const playbookCol = await col<PlaybookDoc>("playbook");
    const all = await playbookCol.scan({});
    const rule = all.find((e) => e.doc.rule === "Tool 'flaky_tool' failed 5 times recently.");
    expect(rule).toBeDefined();
    expect(rule!.doc.category).toBe("error_avoidance");
    expect(rule!.doc.helpful_count).toBe(1);
    expect(rule!.doc.harmful_count).toBe(0);
    expect(rule!.doc.active).toBe(true);
  });

  test("a reflection matching an existing rule's prefix reinforces it instead of duplicating", async () => {
    const description = "Tool 'flaky_tool' failed 5 times recently. Consider verifying its configuration.";
    await seedReflection({ description });
    await runCurator();

    // Second, near-identical reflection (same first-60-chars prefix)
    await seedReflection({ description: description + " Extra detail." });
    await runCurator();

    const playbookCol = await col<PlaybookDoc>("playbook");
    const all = await playbookCol.scan({});
    const matching = all.filter((e) => e.doc.rule.startsWith(description.substring(0, 60)));
    expect(matching.length).toBe(1);
    expect(matching[0].doc.helpful_count).toBe(2);
  });

  test("a rule with harmful_count >= 3 and > helpful_count is deactivated on the next curator run", async () => {
    const playbookCol = await col<PlaybookDoc>("playbook");
    const now = Date.now();
    await playbookCol.put("bad-rule", {
      id: "bad-rule",
      rule: "This rule turned out to be harmful.",
      category: "optimization",
      applicable_to: null,
      helpful_count: 1,
      harmful_count: 3,
      active: true,
      source_reflection_id: "NO_PARENT",
      created_at: now,
      updated_at: now,
    }, { expectedVersion: 0 });

    await runCurator();

    const entry = await playbookCol.get("bad-rule");
    expect(entry!.doc.active).toBe(false);
  });
});

describe("curator: G9 evaluateHarness() insight category mapping", () => {
  test("root_cause insights map to the error_avoidance category", async () => {
    await seedReflection({
      insight_type: "root_cause",
      description: "Root cause in stream s1: called deploy_prod without running tests first.",
    });

    await runCurator();

    const playbookCol = await col<PlaybookDoc>("playbook");
    const all = await playbookCol.scan({});
    const rule = all.find((e) => e.doc.rule.startsWith("Root cause in stream s1"));
    expect(rule).toBeDefined();
    expect(rule!.doc.category).toBe("error_avoidance");
  });

  test("learning_proposal insights map to the response_quality category", async () => {
    await seedReflection({
      insight_type: "learning_proposal",
      description: "Add pre-checks before calling tool 'flaky_tool' to avoid repeated errors",
    });

    await runCurator();

    const playbookCol = await col<PlaybookDoc>("playbook");
    const all = await playbookCol.scan({});
    const rule = all.find((e) => e.doc.rule.startsWith("Add pre-checks before calling tool"));
    expect(rule).toBeDefined();
    expect(rule!.doc.category).toBe("response_quality");
  });
});
