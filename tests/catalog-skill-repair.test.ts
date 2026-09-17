process.env.HIVE_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { AgentDoc } from "../packages/core/src/storage/collections";
import { seedAllData } from "../packages/core/src/storage/seed";

describe("catalog reconciliation", () => {
  beforeEach(async () => {
    closeHiveDb();
    await ensureHiveDb();
  });

  afterEach(() => closeHiveDb());

  test("restores canonical skills removed from a catalog agent", async () => {
    const agents = await col<AgentDoc>("agents");
    const entry = (await agents.get("a2ui_builder"))!;
    const currentSkills = JSON.parse(entry.doc.skills_json ?? "[]") as string[];
    await agents.put(
      entry.id,
      { ...entry.doc, skills_json: JSON.stringify(currentSkills.filter((skill) => skill !== "a2ui_form")) },
      { expectedVersion: entry.version },
    );

    await seedAllData();

    const repaired = (await agents.get("a2ui_builder"))!;
    expect(JSON.parse(repaired.doc.skills_json ?? "[]")).toContain("a2ui_form");
  });

  test("rewrites voseo stock prompt lines and keeps user-written ones", async () => {
    const agents = await col<AgentDoc>("agents");
    const entry = (await agents.get("a2ui_builder"))!;
    const stock = entry.doc.system_prompt;
    const userLine = "- Nunca usás emojis en los IDs.";
    const legacy = stock
      .replace("no pides confirmaciones", "no pedís confirmaciones")
      .replace("Devuelve exclusivamente", "Devolvé exclusivamente")
      .replace("Diseña una jerarquía", "Diseñá una jerarquía")
      + `\n${userLine}`;
    expect(legacy).toContain("pedís");
    expect(legacy).toContain("Devolvé");
    expect(legacy).toContain("Diseñá");
    await agents.put(entry.id, { ...entry.doc, system_prompt: legacy }, { expectedVersion: entry.version });

    await seedAllData();

    const migrated = (await agents.get("a2ui_builder"))!;
    expect(migrated.doc.system_prompt).toBe(`${stock}\n${userLine}`);
  });
});
