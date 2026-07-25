/**
 * A catalog persona is a capability of the whole hive, not a disposable
 * worker: nothing automatic may switch one off. Disabling is the user's call,
 * from the Agents UI (PUT /api/agents/:id). Uses HIVE_DB_PATH=":memory:".
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { AgentDoc, AgentProposalDoc } from "../packages/core/src/storage/collections";
import { runCurator } from "../packages/core/src/agent/curator";
import { agentArchiveTool } from "../packages/core/src/tools/agents";
import { CATALOG_AGENT_IDS } from "../packages/core/src/agent/agent-catalog";

const VICTIM = "workspace_file_operator";

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

async function setCounters(id: string, helpful: number, harmful: number): Promise<void> {
  const agentsCol = await col<AgentDoc>("agents");
  const entry = (await agentsCol.get(id))!;
  await agentsCol.put(id, { ...entry.doc, helpful_count: helpful, harmful_count: harmful }, { expectedVersion: entry.version });
}

describe("curator", () => {
  test("never disables a catalog agent, however bad its ACE counters are", async () => {
    await setCounters(VICTIM, 0, 25);

    await runCurator();

    expect((await agent(VICTIM)).enabled).toBe(true);
  });

  test("raises a reviewable proposal instead of applying the change", async () => {
    await setCounters(VICTIM, 0, 5);

    await runCurator();

    const proposals = (await (await col<AgentProposalDoc>("agentProposals")).findBy("agent_id", VICTIM)).map(e => e.doc);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].type).toBe("disable_agent");
    expect(proposals[0].status).toBe("proposed");
  });

  test("does not archive catalog agents that were never used", async () => {
    // Seeded with lastTraceAt=null, which the inactivity cutoff reads as epoch 0
    expect((await agent(VICTIM)).lastTraceAt).toBeNull();

    await runCurator();

    for (const id of CATALOG_AGENT_IDS) {
      expect((await agent(id)).status).not.toBe("archived");
    }
  });

  test("still archives an inactive worker the user's agent created", async () => {
    const agentsCol = await col<AgentDoc>("agents");
    const stale = { ...(await agent(VICTIM)), id: "stale-worker", source: "user" as const, lastTraceAt: 1 };
    await agentsCol.put(stale.id, stale);

    await runCurator();

    expect((await agent("stale-worker")).status).toBe("archived");
  });
});

describe("agent_archive tool", () => {
  test("refuses to archive a catalog agent", async () => {
    const result = await agentArchiveTool.execute({ agentId: VICTIM }) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toContain("catalog agent");
    expect((await agent(VICTIM)).enabled).toBe(true);
  });

  test("still archives a worker created by the coordinator", async () => {
    const agentsCol = await col<AgentDoc>("agents");
    const worker = { ...(await agent(VICTIM)), id: "spawned-worker", source: "user" as const };
    await agentsCol.put(worker.id, worker);

    const result = await agentArchiveTool.execute({ agentId: "spawned-worker" }) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect((await agent("spawned-worker")).enabled).toBe(false);
  });
});
