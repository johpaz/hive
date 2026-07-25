/**
 * HiveDB capability search — integration tests
 *
 * Covers the capability search layer:
 * packages/core/src/agent/capability-search.ts on top of @johpaz/hive-db.
 *
 * Uses an in-memory index (HIVE_DB_PATH=":memory:") so no state
 * touches ~/.hive.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  searchCapabilities,
  applyRelativeCutoff,
  replaceCapabilityDocs,
  upsertCapabilityDocs,
  deleteCapabilitiesByServer,
} from "../packages/core/src/agent/capability-search";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";

beforeAll(async () => {
  await replaceCapabilityDocs("tool", [
    {
      type: "tool",
      rawId: "web_search",
      name: "web_search",
      body: "Busca en internet información actualizada, noticias e investigación",
      tags: "web",
    },
    {
      type: "tool",
      rawId: "cron.create",
      name: "cron.create",
      body: "Programar tareas recurrentes, crear recordatorios y automatizar horarios",
      tags: "scheduling",
    },
  ]);
  await replaceCapabilityDocs("skill", [
    {
      type: "skill",
      rawId: "reportes",
      name: "generación de reportes",
      body: "Genera reportes mensuales de transacciones y métricas",
      tags: "reportes análisis",
    },
  ]);
  await replaceCapabilityDocs("mcp", [
    {
      type: "mcp",
      rawId: "gmail__send_email",
      name: "send_email",
      body: "Send an email to a recipient",
      tags: "mcp gmail",
      extraFilters: [{ field: "server_id", value: "gmail" }],
    },
    {
      type: "mcp",
      rawId: "github__create_issue",
      name: "create_issue",
      body: "Create a GitHub issue",
      tags: "mcp github",
      extraFilters: [{ field: "server_id", value: "github" }],
    },
  ]);
});

afterAll(() => {
  closeHiveDb();
});

describe("HiveDB capability search", () => {
  test("Spanish stemming: 'reporte' finds 'reportes'", async () => {
    const hits = await searchCapabilities("reporte", { types: ["skill"] });
    expect(hits.length).toBe(1);
    expect(hits[0].rawId).toBe("reportes");
    expect(hits[0].score).toBeGreaterThan(0);
  });

  test("accent folding: 'transaccion' finds 'transacciones'", async () => {
    const hits = await searchCapabilities("transaccion", { types: ["skill"] });
    expect(hits.length).toBe(1);
    expect(hits[0].rawId).toBe("reportes");
  });

  test("raw user input with operators and punctuation never throws", async () => {
    for (const q of [
      '"comillas sin cerrar',
      "¿puedes buscar (noticias) OR NOT?",
      "a:b* ~^",
      "***",
    ]) {
      const hits = await searchCapabilities(q, {});
      expect(Array.isArray(hits)).toBe(true);
    }
    // And the natural-language version still matches
    const hits = await searchCapabilities("¿puedes buscar noticias en internet?", {
      types: ["tool"],
    });
    expect(hits.map((h) => h.rawId)).toContain("web_search");
  });

  test("type filter isolates result sets", async () => {
    // "email" only exists in MCP docs
    const mcpHits = await searchCapabilities("email", { types: ["mcp"] });
    expect(mcpHits.length).toBe(1);
    expect(mcpHits[0].type).toBe("mcp");

    const toolHits = await searchCapabilities("email", { types: ["tool"] });
    expect(toolHits.length).toBe(0);
  });

  test("all-types search returns namespaced hits", async () => {
    const hits = await searchCapabilities("reportes internet email");
    const types = new Set(hits.map((h) => h.type));
    expect(types.has("tool")).toBe(true);
    expect(types.has("skill")).toBe(true);
    expect(types.has("mcp")).toBe(true);
    for (const hit of hits) {
      expect(hit.id).toBe(`${hit.type}:${hit.rawId}`);
    }
  });

  test("replaceCapabilityDocs does not duplicate on re-sync", async () => {
    // Simulate the startup sync running twice
    await replaceCapabilityDocs("tool", [
      {
        type: "tool",
        rawId: "web_search",
        name: "web_search",
        body: "Busca en internet información actualizada, noticias e investigación",
        tags: "web",
      },
      {
        type: "tool",
        rawId: "cron.create",
        name: "cron.create",
        body: "Programar tareas recurrentes, crear recordatorios y automatizar horarios",
        tags: "scheduling",
      },
    ]);
    const hits = await searchCapabilities("internet noticias", { types: ["tool"], k: 20 });
    const ids = hits.map((h) => h.rawId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === "web_search").length).toBe(1);
  });

  test("MCP server disconnect removes only that server's docs", async () => {
    await deleteCapabilitiesByServer("gmail");

    const emailHits = await searchCapabilities("email", { types: ["mcp"] });
    expect(emailHits.length).toBe(0);

    const githubHits = await searchCapabilities("github issue", { types: ["mcp"] });
    expect(githubHits.map((h) => h.rawId)).toContain("github__create_issue");

    // Restore for other tests
    await upsertCapabilityDocs([
      {
        type: "mcp",
        rawId: "gmail__send_email",
        name: "send_email",
        body: "Send an email to a recipient",
        tags: "mcp gmail",
        extraFilters: [{ field: "server_id", value: "gmail" }],
      },
    ]);
  });

  test("applyRelativeCutoff drops weak hits, keeps strong ones", () => {
    const hits = [
      { id: "tool:a", type: "tool" as const, rawId: "a", score: 10 },
      { id: "tool:b", type: "tool" as const, rawId: "b", score: 5 },
      { id: "tool:c", type: "tool" as const, rawId: "c", score: 1 },
    ];
    const kept = applyRelativeCutoff(hits, 0.3);
    expect(kept.map((h) => h.rawId)).toEqual(["a", "b"]);
    expect(applyRelativeCutoff([], 0.3)).toEqual([]);
  });

  test("selector-path latency stays under 50ms warm", async () => {
    await searchCapabilities("warmup", { types: ["tool"] });
    const start = performance.now();
    await searchCapabilities("programar recordatorio diario", { types: ["tool"] });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
