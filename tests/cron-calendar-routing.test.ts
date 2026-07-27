process.env.HIVE_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSeedCatalogAgents } from "../packages/core/src/agent/agent-catalog";
import {
  renderAgentRoutingCatalog,
  searchCatalogAgents,
  syncCatalogAgentsToIndex,
} from "../packages/core/src/agent/catalog-selector";
import { selectSkills, syncSkillsToIndex } from "../packages/core/src/agent/skill-selector";
import {
  CORE_TOOL_CATALOG,
  selectTools,
  syncToolCatalogToIndex,
} from "../packages/core/src/agent/tool-selector";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { AgentDoc } from "../packages/core/src/storage/collections";
import { cronCreateTool } from "../packages/core/src/tools/cron";
import { saveUserProfile } from "../packages/core/src/storage/onboarding";

const CRON_AGENT_ID = "schedule_automation_agent";

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

describe("cron and calendar routing", () => {
  test("defines cron as scheduled automation, never as a calendar operator", () => {
    const agent = createSeedCatalogAgents().find((item) => item.id === CRON_AGENT_ID);

    expect(agent?.name).toBe("Operador de cron");
    expect(agent?.description).toContain("jobs programados");
    expect(agent?.description.toLowerCase()).not.toContain("agenda");

    const exclusions = JSON.parse(agent?.routing_exclusions_json ?? "[]") as string[];
    expect(exclusions.join(" ").toLowerCase()).toContain("eventos de calendario");

    const roster = renderAgentRoutingCatalog([agent!]);
    expect(roster).toContain("NO usar para");
    expect(roster).toContain("eventos de calendario");
  });

  test("does not retrieve the cron agent for a calendar event request", async () => {
    await syncCatalogAgentsToIndex();

    const results = await searchCatalogAgents(
      "crear una cita y agregar un evento al calendario de Google",
      9,
    );

    expect(results.map(({ agent }) => agent.id)).not.toContain(CRON_AGENT_ID);
  });

  test("still retrieves the cron agent for a scheduled Hive automation", async () => {
    await syncCatalogAgentsToIndex();

    const results = await searchCatalogAgents(
      "programar un reporte automático cada lunes con un cron job",
      9,
    );

    expect(results.map(({ agent }) => agent.id)).toContain(CRON_AGENT_ID);
  });

  test("keeps calendar vocabulary out of cron tool discovery", () => {
    const descriptor = CORE_TOOL_CATALOG.find((tool) => tool.name === "cron.create");
    const descriptions = `${descriptor?.description ?? ""} ${cronCreateTool.description}`.toLowerCase();

    expect(descriptions).not.toContain("agendar");
    expect(descriptions).not.toContain("calendario");
    expect(descriptions).toContain("automatización");
  });

  test("does not retrieve cron skills for calendar operations", async () => {
    await syncSkillsToIndex();

    const results = await selectSkills("crear evento en calendario e invitar asistentes");

    expect(results.map((result) => result.id)).not.toContain("cron_manager");
    expect(results.map((result) => result.id)).not.toContain("cron_reminder");
  });

  test("does not inject native cron tools for calendar operations", async () => {
    await syncToolCatalogToIndex();

    const results = await selectTools("agenda una reunión en Google Calendar");

    expect(results.some((result) => result.name.startsWith("cron."))).toBe(false);
  });

  test("teaches existing stock coordinators the cron/calendar boundary", async () => {
    await saveUserProfile({
      userId: "routing-user",
      agentId: "routing-coordinator",
      agentName: "Bee",
    });

    const coordinator = await (await col<AgentDoc>("agents")).get("routing-coordinator");
    const prompt = coordinator?.doc.system_prompt ?? "";

    expect(prompt).toContain("CALENDARIO NO ES CRON");
    expect(prompt).toContain("especialista MCP");
    expect(prompt).toContain("eventos, citas o reuniones");
  });
});
