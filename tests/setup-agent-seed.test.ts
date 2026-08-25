/**
 * Tests for the setup/onboarding step that seeds every agent row with the
 * coordinator's provider/model. Uses HIVE_DB_PATH=":memory:" so no state
 * persists between runs.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col, fromIndexable, toIndexable } from "../packages/core/src/storage/hive";
import type { AgentDoc, ModelDoc } from "../packages/core/src/storage/collections";
import { seedAllData } from "../packages/core/src/storage/seed";
import { saveAgentConfig, propagateCoordinatorModel } from "../packages/core/src/storage/onboarding";
import { CATALOG_AGENT_IDS } from "../packages/core/src/agent/agent-catalog";

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

async function agent(id: string): Promise<AgentDoc> {
  const entry = await (await col<AgentDoc>("agents")).get(id);
  if (!entry) throw new Error(`agent not found: ${id}`);
  return entry.doc;
}

describe("catalog agents after boot", () => {
  test("are seeded without a provider/model pair", async () => {
    for (const id of CATALOG_AGENT_IDS) {
      const doc = await agent(id);
      expect(fromIndexable(doc.provider_id)).toBeNull();
      expect(fromIndexable(doc.model_id)).toBeNull();
    }
  });
});

describe("saveAgentConfig", () => {
  test("seeds a coordinator prompt with the specialist map and delegation priority", async () => {
    const coordinatorId = await saveAgentConfig({
      userId: "user-1",
      agentName: "Bee",
      tone: "friendly",
      providerId: "gemini",
      modelId: "gemini-3.6-flash",
    });

    const prompt = (await agent(coordinatorId)).system_prompt;
    expect(prompt).toContain("## 2. MAPA RÁPIDO DE ESPECIALISTAS");
    expect(prompt).toContain("`a2ui_builder`: construye formularios, dashboards y flujos interactivos A2UI.");
    expect(prompt).toContain("`software_engineer`: implementa, depura y prueba software en un repositorio.");
    expect(prompt).toContain("primero elige un agente de este mapa");
    // El prompt no lleva el nombre escrito: la identidad la inyecta
    // prompt-builder desde `agents.name`, que es lo que el usuario configuró.
    expect(prompt).not.toContain("Sos Bee");
    expect(prompt).toContain("Eres el coordinador de Hive");
    expect(prompt).toContain("verifica antes que aparezca activo en la COLMENA");
    expect(prompt.indexOf("task_delegate")).toBeLessThan(prompt.indexOf("search_knowledge"));
  });

  test("seeds every catalog agent with the coordinator's provider/model", async () => {
    const agentId = await saveAgentConfig({
      userId: "user-1",
      agentName: "Bee",
      tone: "friendly",
      providerId: "gemini",
      modelId: "gemini-3.6-flash",
    });

    const coordinator = await agent(agentId);
    expect(coordinator.role).toBe("coordinator");
    expect(fromIndexable(coordinator.provider_id)).toBe("gemini");

    for (const id of CATALOG_AGENT_IDS) {
      const doc = await agent(id);
      expect(fromIndexable(doc.provider_id)).toBe("gemini");
      expect(fromIndexable(doc.model_id)).toBe("gemini-3.6-flash");
      expect(doc.user_id).toBe("user-1");
      expect(doc.role).toBe("worker");
      // The rest of the persona survives the rewrite untouched
      expect(doc.enabled).toBe(true);
      expect(doc.status).toBe("idle");
      expect(doc.source).toBe("catalog");
      expect(doc.tool_allowlist_json).toBeTruthy();
      expect(doc.system_prompt.length).toBeGreaterThan(0);
    }
  });

  test("leaves the workers untouched while the coordinator has no model yet", async () => {
    await saveAgentConfig({
      userId: "user-1",
      agentName: "Bee",
      tone: "friendly",
      providerId: "",
      modelId: "",
    });

    const doc = await agent(CATALOG_AGENT_IDS[0]);
    expect(fromIndexable(doc.provider_id)).toBeNull();
    expect(fromIndexable(doc.model_id)).toBeNull();
  });

  test("ignores a provider/model that is not in the catalog tables", async () => {
    await saveAgentConfig({
      userId: "user-1",
      agentName: "Bee",
      tone: "friendly",
      providerId: "not-a-provider",
      modelId: "not-a-model",
    });

    const doc = await agent(CATALOG_AGENT_IDS[0]);
    expect(fromIndexable(doc.provider_id)).toBeNull();
  });
});

describe("reseed on an already-configured install (boot, no setup)", () => {
  async function configuredInstall(): Promise<string> {
    return saveAgentConfig({
      userId: "user-1",
      agentName: "Bee",
      tone: "friendly",
      providerId: "gemini",
      modelId: "gemini-3.6-flash",
    });
  }

  test("keeps every agent enabled and configured across a reseed", async () => {
    const coordinatorId = await configuredInstall();
    const agentsCol = await col<AgentDoc>("agents");
    // A worker the user pointed at a different model from the UI
    const custom = { ...(await agent(CATALOG_AGENT_IDS[0])), id: "custom-worker" };
    await agentsCol.put(custom.id, { ...custom, provider_id: toIndexable("openai"), model_id: toIndexable("gpt-5.6-luna") });
    // A persona the user disabled
    const off = await agent(CATALOG_AGENT_IDS[1]);
    await agentsCol.put(off.id, { ...off, enabled: false }, { expectedVersion: (await agentsCol.get(off.id))!.version });

    await seedAllData();

    expect(fromIndexable((await agent(coordinatorId)).model_id)).toBe("gemini-3.6-flash");
    for (const id of CATALOG_AGENT_IDS) {
      const doc = await agent(id);
      expect(fromIndexable(doc.provider_id)).toBe("gemini");
      expect(fromIndexable(doc.model_id)).toBe("gemini-3.6-flash");
    }
    // Per-agent choices and toggles survive the reseed
    expect(fromIndexable((await agent("custom-worker")).model_id)).toBe("gpt-5.6-luna");
    expect((await agent(CATALOG_AGENT_IDS[1])).enabled).toBe(false);
  });

  test("migrates the legacy cron persona stored in the database", async () => {
    await configuredInstall();
    const agentsCol = await col<AgentDoc>("agents");
    const cronId = "schedule_automation_agent";
    const current = (await agentsCol.get(cronId))!;
    await agentsCol.put(cronId, {
      ...current.doc,
      name: "Operador de agenda",
      description: "Crea y administra recordatorios y automatizaciones temporales con zona horaria correcta.",
      system_prompt: current.doc.system_prompt
        .replace(
          "Tu dominio son los jobs técnicos programados de Hive, su recurrencia, ventanas temporales y zonas horarias.",
          "Tu dominio es recordatorios, cron recurrente, ventanas temporales y zonas horarias.",
        )
        .replace(
          "Una automatización que Hive debe ejecutar después, su horario o recurrencia, timezone, canal y comportamiento esperado.",
          "Acción temporal, horario expresado por el usuario, timezone, canal y comportamiento esperado.",
        ),
      enabled: false,
      helpful_count: 7,
    }, { expectedVersion: current.version });

    await seedAllData();

    const migrated = await agent(cronId);
    expect(migrated.name).toBe("Operador de cron");
    expect(migrated.description).toContain("jobs programados");
    expect(migrated.system_prompt).toContain("jobs técnicos programados");
    expect(migrated.system_prompt).not.toContain("Tu dominio es recordatorios");
    expect(migrated.enabled).toBe(false);
    expect(migrated.helpful_count).toBe(7);
    expect(fromIndexable(migrated.model_id)).toBe("gemini-3.6-flash");
  });

  test("configures a persona added by an upgrade", async () => {
    await configuredInstall();
    const agentsCol = await col<AgentDoc>("agents");
    // Simulates a new catalog row landing blank, the way createSeedCatalogAgents seeds it
    const fresh = {
      ...(await agent(CATALOG_AGENT_IDS[0])),
      id: "new_persona",
      user_id: "",
      provider_id: toIndexable(null),
      model_id: toIndexable(null),
    };
    await agentsCol.put(fresh.id, fresh);

    await seedAllData();

    const doc = await agent("new_persona");
    expect(fromIndexable(doc.provider_id)).toBe("gemini");
    expect(fromIndexable(doc.model_id)).toBe("gemini-3.6-flash");
    expect(doc.user_id).toBe("user-1");
    expect(doc.enabled).toBe(true);
  });

  test("keeps a model discovered from a provider, and the agents pointing at it", async () => {
    const modelsCol = await col<ModelDoc>("models");
    await modelsCol.put("llama3.2:latest", {
      id: "llama3.2:latest", provider_id: "ollama", name: "llama3.2:latest", model_type: "llm",
      context_window: 0, capabilities: null, enabled: true, active: true, source: "discovered",
    });
    const coordinatorId = await saveAgentConfig({
      userId: "user-1",
      agentName: "Bee",
      tone: "friendly",
      providerId: "ollama",
      modelId: "llama3.2:latest",
    });

    await seedAllData();

    expect(await modelsCol.get("llama3.2:latest")).toBeTruthy();
    expect(fromIndexable((await agent(coordinatorId)).model_id)).toBe("llama3.2:latest");
    expect(fromIndexable((await agent(CATALOG_AGENT_IDS[0])).model_id)).toBe("llama3.2:latest");
  });

  test("still unlinks agents from a catalog model that was dropped", async () => {
    const modelsCol = await col<ModelDoc>("models");
    await modelsCol.put("retired-model", {
      id: "retired-model", provider_id: "gemini", name: "retired", model_type: "llm",
      context_window: 0, capabilities: null, enabled: true, active: true, source: "catalog",
    });
    const agentsCol = await col<AgentDoc>("agents");
    const orphan = { ...(await agent(CATALOG_AGENT_IDS[0])), id: "orphan-worker", model_id: toIndexable("retired-model") };
    await agentsCol.put(orphan.id, orphan);

    await seedAllData();

    expect(await modelsCol.get("retired-model")).toBeUndefined();
    // No coordinator configured here, so nothing refills it
    expect(fromIndexable((await agent("orphan-worker")).model_id)).toBeNull();
  });
});

describe("propagateCoordinatorModel", () => {
  test("covers workers created outside the catalog and skips coordinators", async () => {
    const agentsCol = await col<AgentDoc>("agents");
    const now = Date.now();
    const worker = { ...(await agent(CATALOG_AGENT_IDS[0])), id: "custom-worker", source: "user" as const };
    await agentsCol.put(worker.id, worker);
    const coordinatorId = await saveAgentConfig({
      userId: "user-1",
      agentName: "Bee",
      tone: "friendly",
      providerId: "gemini",
      modelId: "gemini-3.6-flash",
    });

    const updated = await propagateCoordinatorModel("user-1", "openai", "gpt-5.6-luna");
    expect(updated).toBe(CATALOG_AGENT_IDS.length + 1);
    expect(fromIndexable((await agent("custom-worker")).provider_id)).toBe("openai");
    // The coordinator keeps what saveAgentConfig persisted for it
    expect(fromIndexable((await agent(coordinatorId)).model_id)).toBe("gemini-3.6-flash");
    expect((await agent(CATALOG_AGENT_IDS[0])).updated_at).toBeGreaterThanOrEqual(now);

    // Idempotent: a second run with the same pair rewrites nothing
    expect(await propagateCoordinatorModel("user-1", "openai", "gpt-5.6-luna")).toBe(0);
  });

  test("keeps a user_id that is already set", async () => {
    const agentsCol = await col<AgentDoc>("agents");
    const owned = { ...(await agent(CATALOG_AGENT_IDS[0])), id: "owned-worker", user_id: "other-user" };
    await agentsCol.put(owned.id, owned);

    await propagateCoordinatorModel("user-1", "openai", "gpt-5.6-luna");

    expect((await agent("owned-worker")).user_id).toBe("other-user");
    expect((await agent("owned-worker")).provider_id).toBe(toIndexable("openai"));
  });
});
