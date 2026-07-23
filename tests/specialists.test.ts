process.env.HIVE_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { col } from "../packages/core/src/storage/hive";
import type { AgentDoc, SpecialistDoc } from "../packages/core/src/storage/collections";
import { toIndexable } from "../packages/core/src/storage/hive";
import { seedAllData } from "../packages/core/src/storage/seed";
import {
  listActiveSpecialists,
  searchSpecialists,
  syncSpecialistsToIndex,
} from "../packages/core/src/agent/specialist-selector";
import { expandToolAllowlist, wakeSpecialist } from "../packages/core/src/agent/specialist-runtime";
import { persistVerification } from "../packages/core/src/agent/acceptance-verifier";

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
});

afterEach(() => closeHiveDb());

describe("specialist catalog", () => {
  test("seeds 13 dormant templates with independently routable descriptions", async () => {
    const specialists = await listActiveSpecialists();
    expect(specialists).toHaveLength(13);
    expect(specialists.some((item) => item.id === "acceptance_verifier")).toBe(true);
    expect(specialists.every((item) => item.description.split("\n").length === 1)).toBe(true);
  });

  test("seed is insert-only and preserves learned or user changes", async () => {
    const c = await col<SpecialistDoc>("specialists");
    const current = await c.get("office_document_specialist");
    expect(current).toBeDefined();
    await c.put(current!.id, { ...current!.doc, description: "custom routing description" }, { expectedVersion: current!.version });
    await seedAllData();
    expect((await c.get(current!.id))!.doc.description).toBe("custom routing description");
  });

  test("BM25 routes an Office task to the Office specialist", async () => {
    await syncSpecialistsToIndex();
    const hits = await searchSpecialists("crear una hoja Excel con ventas");
    expect(hits.some((hit) => hit.specialist.id === "office_document_specialist")).toBe(true);
  });

  test("verifier allowlist expands to read-only native tools", async () => {
    const verifier = await (await col<SpecialistDoc>("specialists")).get("acceptance_verifier");
    const expanded = expandToolAllowlist(verifier!.doc.tool_allowlist, [
      "fs_read", "fs_write", "fs_exists", "browser_click", "browser_screenshot",
      "office_leer_pdf", "office_escribir_pdf", "cron.list", "cron.create",
    ]);
    expect(expanded).toContain("fs_read");
    expect(expanded).toContain("office_leer_pdf");
    expect(expanded).not.toContain("fs_write");
    expect(expanded).not.toContain("browser_click");
    expect(expanded).not.toContain("cron.create");
  });

  test("materializes a dormant specialist with a closed loadout and reuses its stable worker id", async () => {
    const now = Date.now();
    const agents = await col<AgentDoc>("agents");
    await agents.put("main", {
      id: "main",
      user_id: "u1",
      name: "Main",
      description: "Coordinator",
      system_prompt: "Coordinate",
      tone: "direct",
      role: "coordinator",
      status: "idle",
      enabled: true,
      provider_id: toIndexable("provider"),
      model_id: toIndexable("model"),
      tools_json: null,
      skills_json: null,
      parent_id: toIndexable(null),
      max_iterations: 20,
      workspace: "/tmp/hive-specialist-test",
      lastTraceAt: null,
      created_at: now,
      updated_at: now,
    }, { expectedVersion: 0 });

    const first = await wakeSpecialist({
      specialistId: "office_document_specialist",
      userId: "u1",
      parentAgentId: "main",
      workspace: "/tmp/hive-specialist-test",
    });
    const second = await wakeSpecialist({
      specialistId: "office_document_specialist",
      userId: "u1",
      parentAgentId: "main",
      workspace: "/tmp/hive-specialist-test",
    });
    expect(second.workerId).toBe(first.workerId);
    expect(first.toolNames.every((name) => name.startsWith("office_") || name === "fs_exists")).toBe(true);
    const worker = await agents.get(first.workerId);
    expect(worker!.doc.specialist_id).toBe("office_document_specialist");
    expect(JSON.parse(worker!.doc.skills_json!)).toEqual(["office_document_manager"]);
    await first.release();
    await second.release();
  });

  test("only the MCP operator can receive task-scoped MCP servers", async () => {
    const now = Date.now();
    const agents = await col<AgentDoc>("agents");
    await agents.put("main", {
      id: "main",
      user_id: "u1",
      name: "Main",
      description: "Coordinator",
      system_prompt: "Coordinate",
      tone: "direct",
      role: "coordinator",
      status: "idle",
      enabled: true,
      provider_id: toIndexable("provider"),
      model_id: toIndexable("model"),
      tools_json: null,
      skills_json: null,
      parent_id: toIndexable(null),
      max_iterations: 20,
      workspace: "/tmp/hive-specialist-test",
      lastTraceAt: null,
      created_at: now,
      updated_at: now,
    }, { expectedVersion: 0 });

    await expect(wakeSpecialist({
      specialistId: "office_document_specialist",
      userId: "u1",
      parentAgentId: "main",
      workspace: "/tmp/hive-specialist-test",
      mcpServerIds: ["external-service"],
    })).rejects.toThrow("does not allow task-scoped MCP servers");
  });

  test("ACE counters follow independent verdicts instead of loop completion", async () => {
    await persistVerification({
      runId: "run-rejected",
      executorSpecialistId: "office_document_specialist",
      objective: "Create a workbook",
      acceptance: [{ id: "opens", description: "Workbook opens" }],
      verdict: {
        status: "needs_evidence",
        criterion_results: [{
          criterion_id: "opens",
          met: false,
          evidence: [],
          check_used: "readback",
          confidence: 0.8,
        }],
        summary: "No readback",
        retry_guidance: "Open the generated workbook",
        risks: [],
      },
    });
    await persistVerification({
      runId: "run-verified",
      executorSpecialistId: "office_document_specialist",
      objective: "Create a workbook",
      acceptance: [{ id: "opens", description: "Workbook opens" }],
      verdict: {
        status: "verified",
        criterion_results: [{
          criterion_id: "opens",
          met: true,
          evidence: ["Workbook reopened successfully"],
          check_used: "office_leer_xlsx",
          confidence: 1,
        }],
        summary: "Verified",
        retry_guidance: null,
        risks: [],
      },
    });

    const specialist = await (await col<SpecialistDoc>("specialists")).get("office_document_specialist");
    expect(specialist!.doc.helpful_count).toBe(1);
    expect(specialist!.doc.harmful_count).toBe(1);
  });
});
