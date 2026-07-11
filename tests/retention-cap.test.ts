import { describe, it, expect, beforeEach } from "bun:test";
process.env.HIVE_DB_PATH = ":memory:";

import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import { reconcileOnBoot } from "../packages/core/src/storage/reconcile";

beforeEach(async () => {
  await closeHiveDb();
  await ensureHiveDb();
});

describe("retention cap in reconcileOnBoot", () => {
  it("caps agentRuns to 500 per thread", async () => {
    const agentRunsCol = await col<any>("agentRuns");
    // Insert 510 runs for the same thread
    for (let i = 0; i < 510; i++) {
      await agentRunsCol.put(`run-${i}`, {
        agent_id: "agent-1",
        thread_id: "thread-1",
        kind: "chat",
        status: "completed",
        created_at: i, // ascending so higher = newer
        lease_expires_at: Date.now() + 60000,
      });
    }
    const beforeCount = (await agentRunsCol.scan({})).length;
    expect(beforeCount).toBe(510);

    await reconcileOnBoot("test-boot");

    const afterCount = (await agentRunsCol.scan({})).length;
    expect(afterCount).toBe(500);

    // Verify we kept the newest (highest created_at)
    const remaining = await agentRunsCol.scan({});
    const ids = remaining.map((e: any) => parseInt(e.id.split("-")[1]));
    expect(Math.min(...ids)).toBe(10); // first 10 pruned, 10..509 kept
  });

  it("caps jobs to 500 per run_id", async () => {
    const jobsCol = await col<any>("jobQueue");
    for (let i = 0; i < 520; i++) {
      await jobsCol.put(`job-${i}`, {
        lane: "default",
        type: "chat_turn",
        status: "completed",
        run_id: "run-1",
        attempts: 1,
        max_attempts: 3,
        lease_expires_at: null,
        created_at: i,
        payload_json: "{}",
        priority: 0,
        not_before: 0,
        boot_id: null,
        result_json: null,
        error: null,
        started_at: null,
        finished_at: null,
      });
    }
    const beforeCount = (await jobsCol.scan({})).length;
    expect(beforeCount).toBe(520);

    await reconcileOnBoot("test-boot");

    const afterCount = (await jobsCol.scan({})).length;
    expect(afterCount).toBe(500);
  });

  it("does not prune when under the cap", async () => {
    const agentRunsCol = await col<any>("agentRuns");
    for (let i = 0; i < 100; i++) {
      await agentRunsCol.put(`run-${i}`, {
        agent_id: "agent-1",
        thread_id: "thread-1",
        kind: "chat",
        status: "completed",
        created_at: i,
        lease_expires_at: Date.now() + 60000,
      });
    }

    await reconcileOnBoot("test-boot");

    const afterCount = (await agentRunsCol.scan({})).length;
    expect(afterCount).toBe(100);
  });
});
