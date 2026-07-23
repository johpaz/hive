process.env.HIVE_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { col, toIndexable } from "../packages/core/src/storage/hive";
import type { AgentDoc } from "../packages/core/src/storage/collections";
import { listActiveSpecialists } from "../packages/core/src/agent/specialist-selector";
import { wakeSpecialist } from "../packages/core/src/agent/specialist-runtime";
import { handleGetSpecialists, handlePatchSpecialist } from "../packages/core/src/gateway/routes/specialists";

const identity = (r: Response) => r;

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
});

afterEach(() => closeHiveDb());

async function seedCoordinator() {
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
    workspace: "/tmp/hive-specialist-routes-test",
    lastTraceAt: null,
    created_at: now,
    updated_at: now,
  }, { expectedVersion: 0 });
}

describe("specialists routes", () => {
  test("GET /api/specialists returns all 13 templates dormant by default", async () => {
    const res = await handleGetSpecialists(new Request("http://localhost/api/specialists"), identity);
    const body = await res.json() as { specialists: Array<{ id: string; runtime: { state: string; workers: unknown[] } }> };
    expect(body.specialists).toHaveLength(13);
    expect(body.specialists.every((s) => s.runtime.state === "dormant")).toBe(true);
    expect(body.specialists.every((s) => s.runtime.workers.length === 0)).toBe(true);
  });

  test("a materialized specialist appears awake with its worker id", async () => {
    await seedCoordinator();
    const awake = await wakeSpecialist({
      specialistId: "office_document_specialist",
      userId: "u1",
      parentAgentId: "main",
      workspace: "/tmp/hive-specialist-routes-test",
    });

    const res = await handleGetSpecialists(new Request("http://localhost/api/specialists"), identity);
    const body = await res.json() as { specialists: Array<{ id: string; runtime: { state: string; workers: Array<{ id: string }> } }> };
    const target = body.specialists.find((s) => s.id === "office_document_specialist")!;
    expect(target.runtime.state).toBe("awake");
    expect(target.runtime.workers.map((w) => w.id)).toContain(awake.workerId);

    await awake.release();
  });

  test("PATCH active:false is reflected in GET and excluded from routing", async () => {
    const patchRes = await handlePatchSpecialist(
      new Request("http://localhost/api/specialists/web_researcher", {
        method: "PATCH",
        body: JSON.stringify({ active: false }),
      }),
      identity,
    );
    expect(patchRes.status).toBe(200);

    const getRes = await handleGetSpecialists(new Request("http://localhost/api/specialists"), identity);
    const body = await getRes.json() as { specialists: Array<{ id: string; active: boolean }> };
    const target = body.specialists.find((s) => s.id === "web_researcher")!;
    expect(target.active).toBe(false);

    const active = await listActiveSpecialists();
    expect(active.some((s) => s.id === "web_researcher")).toBe(false);
  });

  test("PATCH on unknown specialist returns 404", async () => {
    const res = await handlePatchSpecialist(
      new Request("http://localhost/api/specialists/does_not_exist", {
        method: "PATCH",
        body: JSON.stringify({ active: false }),
      }),
      identity,
    );
    expect(res.status).toBe(404);
  });
});
