/**
 * Tests: DurableLaneQueue — dispatch, boot re-dispatch, forced reclaim.
 *
 * 1. enqueue → dispatch → executor runs → job completed
 * 2. start() dispatches jobs left pending by a previous boot
 * 3. reconcileOnBoot reclaims "running" jobs immediately (single-process:
 *    any running row at boot belongs to a dead process, lease ignored)
 * 4. reclaimOrInterrupt force interrupts when attempts are exhausted
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId, getBootId } from "../packages/core/src/storage/boot-id";
import { DurableLaneQueue, registerExecutor } from "../packages/core/src/gateway/durable-queue";
import { createJob, claimJob, getJob, reclaimOrInterrupt } from "../packages/core/src/gateway/job-store";
import { reconcileOnBoot } from "../packages/core/src/storage/reconcile";

let queue: DurableLaneQueue | null = null;

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
});

afterEach(() => {
  queue?.stop();
  queue = null;
  closeHiveDb();
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timed out");
}

describe("durable-queue: dispatch + reclaim", () => {
  test("enqueue dispatches the job and persists the executor result", async () => {
    const executed: string[] = [];
    registerExecutor("worker_task", async (job) => {
      executed.push(job.id);
      return { ok: true, result: "done!" };
    });

    queue = new DurableLaneQueue({ maxGlobalConcurrency: 2 });
    const job = await queue.enqueue({
      lane: "task:test-1",
      type: "worker_task",
      run_id: "run-x",
      payload: { hello: "world" },
    });

    await waitFor(async () => (await getJob(job.id))?.status === "completed");

    const finished = await getJob(job.id);
    expect(executed).toContain(job.id);
    expect(finished!.status).toBe("completed");
    expect(JSON.parse(finished!.result_json!)).toBe("done!");
    expect(finished!.boot_id).toBeNull();
  });

  test("a job enqueued while another runs in the same lane waits for it", async () => {
    // Real case: an A2UI action arrived while the delegation summary turn ran
    // in the same conversation; both ran at once and both re-delegated.
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((r) => { releaseFirst = r; });
    registerExecutor("chat_turn", async (job) => {
      const name = (JSON.parse(job.payload_json) as { name: string }).name;
      events.push(`start:${name}`);
      if (name === "summary") await firstMayFinish;
      events.push(`end:${name}`);
      return { ok: true, result: name };
    });

    queue = new DurableLaneQueue({ maxGlobalConcurrency: 4 });
    const lane = "user/webchat/conv-1";
    const first = await queue.enqueue({ lane, type: "chat_turn", run_id: "run-s", payload: { name: "summary" } as never });
    await waitFor(async () => events.includes("start:summary"));
    const second = await queue.enqueue({ lane, type: "chat_turn", run_id: "run-a", payload: { name: "a2ui" } as never });

    // Give the dispatcher every chance to start the second one early.
    await new Promise((r) => setTimeout(r, 150));
    expect(events).toEqual(["start:summary"]);
    expect((await getJob(second.id))?.status).toBe("pending");

    releaseFirst();
    await waitFor(async () => (await getJob(second.id))?.status === "completed");
    expect(events).toEqual(["start:summary", "end:summary", "start:a2ui", "end:a2ui"]);
    expect((await getJob(first.id))?.status).toBe("completed");
  });

  test("cancelling a lane frees it even if the running executor ignores the abort", async () => {
    // Real case: a local model compacting on CPU kept running after the user
    // pressed stop, and the next message waited behind the cancelled turn.
    const events: string[] = [];
    let releaseStuck!: () => void;
    const stuck = new Promise<void>((r) => { releaseStuck = r; });
    registerExecutor("chat_turn", async (job) => {
      const name = (JSON.parse(job.payload_json) as { name: string }).name;
      events.push(`start:${name}`);
      if (name === "stuck") await stuck; // never looks at the abort signal
      events.push(`end:${name}`);
      return { ok: true, result: name };
    });

    queue = new DurableLaneQueue({ maxGlobalConcurrency: 4 });
    const lane = "user/webchat/conv-2";
    const first = await queue.enqueue({ lane, type: "chat_turn", run_id: "run-1", payload: { name: "stuck" } as never });
    await waitFor(async () => events.includes("start:stuck"));

    expect(await queue.cancelLane(lane)).toBe(1);
    const next = await queue.enqueue({ lane, type: "chat_turn", run_id: "run-2", payload: { name: "next" } as never });
    await waitFor(async () => (await getJob(next.id))?.status === "completed");
    expect(events).toEqual(["start:stuck", "start:next", "end:next"]);

    releaseStuck();
    await new Promise((r) => setTimeout(r, 50));
    // The late result of the cancelled turn does not resurrect it.
    expect((await getJob(first.id))?.status).toBe("cancelled");
  });

  test("start() re-dispatches jobs left pending by a previous boot", async () => {
    const executed: string[] = [];
    registerExecutor("worker_task", async (job) => {
      executed.push(job.id);
      return { ok: true, result: null };
    });

    // Jobs created directly (as if the process died right after enqueue)
    const j1 = await createJob({ lane: "task:a", type: "worker_task", payload: {}, run_id: "r1" });
    const j2 = await createJob({ lane: "task:b", type: "worker_task", payload: {}, run_id: "r2" });

    queue = new DurableLaneQueue({ maxGlobalConcurrency: 2 });
    queue.start();

    await waitFor(async () =>
      (await getJob(j1.id))?.status === "completed" && (await getJob(j2.id))?.status === "completed"
    );
    expect(executed.sort()).toEqual([j1.id, j2.id].sort());
  });

  test("reconcileOnBoot reclaims a running job immediately, ignoring its lease", async () => {
    const job = await createJob({ lane: "task:c", type: "worker_task", payload: {}, run_id: "r3" });
    const claimed = await claimJob(job.id, "dead-boot");
    expect(claimed!.status).toBe("running");
    // Lease is still fresh (30 min) — at boot it must be reclaimed anyway
    expect(claimed!.lease_expires_at! > Date.now()).toBe(true);

    await reconcileOnBoot(getBootId());

    const after = await getJob(job.id);
    expect(after!.status).toBe("pending");
    expect(after!.boot_id).toBeNull();
    expect(after!.attempts).toBe(1);
  });

  test("forced reclaim interrupts the job when attempts are exhausted", async () => {
    const job = await createJob({ lane: "task:d", type: "worker_task", payload: {}, run_id: "r4", max_attempts: 2 });
    await claimJob(job.id, "boot-1");            // attempts = 1
    await reclaimOrInterrupt(job.id, { force: true }); // back to pending
    await claimJob(job.id, "boot-2");            // attempts = 2
    const final = await reclaimOrInterrupt(job.id, { force: true });

    expect(final!.status).toBe("interrupted");
    expect(final!.error).toContain("Max attempts");
  });
});
