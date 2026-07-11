/**
 * Tests for gateway/job-store.ts — JobDoc lifecycle, claim OCC, lease renewal,
 * reclaim after expiry, cancel.
 * Uses HIVE_DB_PATH=":memory:" so no state persists between runs.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { col } from "../packages/core/src/storage/hive";
import type { JobDoc } from "../packages/core/src/storage/collections";
import { getBootId, resetBootId } from "../packages/core/src/storage/boot-id";
import {
  createJob,
  claimJob,
  renewLease,
  completeJob,
  failJob,
  reclaimOrInterrupt,
  cancelJob,
  findPendingJobsByLane,
  findExpiredLeases,
  getJob,
} from "../packages/core/src/gateway/job-store";

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

describe("job-store: createJob", () => {
  test("creates a pending job with correct defaults", async () => {
    const job = await createJob({
      lane: "session-1",
      type: "chat_turn",
      payload: { threadId: "t1", message: "hello" },
      run_id: "run1",
    });

    expect(job.status).toBe("pending");
    expect(job.lane).toBe("session-1");
    expect(job.type).toBe("chat_turn");
    expect(job.attempts).toBe(0);
    expect(job.max_attempts).toBe(2);
    expect(job.priority).toBe(0);
    expect(job.boot_id).toBeNull();
    expect(job.lease_expires_at).toBeNull();
    expect(job.result_json).toBeNull();
    expect(job.error).toBeNull();

    const payload = JSON.parse(job.payload_json);
    expect(payload.threadId).toBe("t1");
    expect(payload.message).toBe("hello");
  });

  test("creates with priority and max_attempts overrides", async () => {
    const job = await createJob({
      lane: "task:1",
      type: "worker_task",
      payload: { task: "build" },
      run_id: "run2",
      priority: 10,
      max_attempts: 5,
    });

    expect(job.priority).toBe(10);
    expect(job.max_attempts).toBe(5);
  });
});

describe("job-store: claimJob OCC", () => {
  test("claims a pending job → running with boot_id + lease", async () => {
    const job = await createJob({
      lane: "session-1",
      type: "chat_turn",
      payload: {},
      run_id: "run1",
    });

    const claimed = await claimJob(job.id);
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe("running");
    expect(claimed!.attempts).toBe(1);
    expect(claimed!.boot_id).toBe(getBootId());
    expect(claimed!.lease_expires_at).toBeGreaterThan(Date.now());

    const fromDb = await getJob(job.id);
    expect(fromDb!.status).toBe("running");
  });

  test("claiming a non-pending job returns null", async () => {
    const job = await createJob({
      lane: "session-1",
      type: "chat_turn",
      payload: {},
      run_id: "run1",
    });

    await claimJob(job.id);
    const secondAttempt = await claimJob(job.id);
    expect(secondAttempt).toBeNull();
  });

  test("claiming with not_before in future returns null", async () => {
    const job = await createJob({
      lane: "session-1",
      type: "chat_turn",
      payload: {},
      run_id: "run1",
      not_before: Date.now() + 60_000,
    });

    const claimed = await claimJob(job.id);
    expect(claimed).toBeNull();
  });

  test("two bootIds race — only one wins (OCC guarantee)", async () => {
    const job = await createJob({
      lane: "session-1",
      type: "chat_turn",
      payload: {},
      run_id: "run1",
    });

    // Simulate two different boots attempting claim simultaneously
    const [claim1, claim2] = await Promise.all([
      claimJob(job.id, "boot-A"),
      claimJob(job.id, "boot-B"),
    ]);

    // At least one should win, at most one should win
    const winners = [claim1, claim2].filter((c) => c !== null);
    expect(winners.length).toBe(1);
    const winningBoot = winners[0]!.boot_id;
    expect(["boot-A", "boot-B"]).toContain(winningBoot);
  });
});

describe("job-store: lease renewal", () => {
  test("renewLease extends lease_expires_at", async () => {
    const job = await createJob({
      lane: "s1",
      type: "chat_turn",
      payload: {},
      run_id: "r1",
    });
    await claimJob(job.id);
    const before = await getJob(job.id);
    const oldLease = before!.lease_expires_at!;

    // Wait a bit so the new lease is strictly greater
    await new Promise((r) => setTimeout(r, 10));
    const ok = await renewLease(job.id);
    expect(ok).toBe(true);

    const after = await getJob(job.id);
    expect(after!.lease_expires_at!).toBeGreaterThan(oldLease);
  });

  test("renewLease fails for wrong boot_id", async () => {
    const job = await createJob({
      lane: "s1",
      type: "chat_turn",
      payload: {},
      run_id: "r1",
    });
    await claimJob(job.id, "boot-A");

    const ok = await renewLease(job.id, "boot-B");
    expect(ok).toBe(false);
  });
});

describe("job-store: completeJob / failJob", () => {
  test("completeJob saves result_json and clears lease", async () => {
    const job = await createJob({
      lane: "s1",
      type: "chat_turn",
      payload: {},
      run_id: "r1",
    });
    await claimJob(job.id);

    await completeJob(job.id, { response: "done" });

    const saved = await getJob(job.id);
    expect(saved!.status).toBe("completed");
    expect(saved!.result_json).not.toBeNull();
    const result = JSON.parse(saved!.result_json!);
    expect(result.response).toBe("done");
    expect(saved!.boot_id).toBeNull();
    expect(saved!.lease_expires_at).toBeNull();
    expect(saved!.finished_at).not.toBeNull();
  });

  test("failJob saves error and clears lease", async () => {
    const job = await createJob({
      lane: "s1",
      type: "worker_task",
      payload: {},
      run_id: "r1",
    });
    await claimJob(job.id);

    await failJob(job.id, "Worker crashed");

    const saved = await getJob(job.id);
    expect(saved!.status).toBe("failed");
    expect(saved!.error).toBe("Worker crashed");
    expect(saved!.boot_id).toBeNull();
  });

  test("completeJob refuses to overwrite a job owned by different boot", async () => {
    const job = await createJob({
      lane: "s1",
      type: "chat_turn",
      payload: {},
      run_id: "r1",
    });
    await claimJob(job.id, "boot-A");

    // boot-B tries to complete — should be ignored
    await completeJob(job.id, { response: "bad" }, "boot-B");

    const saved = await getJob(job.id);
    expect(saved!.status).toBe("running");
    expect(saved!.result_json).toBeNull();
  });
});

describe("job-store: reclaimOrInterrupt", () => {
  test("reclaims job back to pending when lease expired and attempts < max", async () => {
    const job = await createJob({
      lane: "s1",
      type: "chat_turn",
      payload: {},
      run_id: "r1",
      max_attempts: 3,
    });
    await claimJob(job.id, "boot-A");

    // Expire the lease
    const c = await col<JobDoc>("jobQueue");
    const entry = await c.get(job.id);
    await c.put(job.id, { ...entry!.doc, lease_expires_at: Date.now() - 1000 }, { expectedVersion: entry!.version });

    const result = await reclaimOrInterrupt(job.id);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("pending");
    expect(result!.attempts).toBe(1);
    expect(result!.boot_id).toBeNull();
  });

  test("interrupts job when attempts exhausted", async () => {
    const job = await createJob({
      lane: "s1",
      type: "worker_task",
      payload: {},
      run_id: "r1",
      max_attempts: 2,
    });
    // Claim twice to exhaust attempts
    await claimJob(job.id, "boot-A");
    const c = await col<JobDoc>("jobQueue");
    let entry = await c.get(job.id);
    await c.put(job.id, { ...entry!.doc, lease_expires_at: Date.now() - 1000 }, { expectedVersion: entry!.version });
    await reclaimOrInterrupt(job.id); // attempt 1 → pending

    entry = await c.get(job.id);
    expect(entry!.doc.status).toBe("pending");

    await claimJob(job.id, "boot-B"); // attempt 2 → running
    entry = await c.get(job.id);
    await c.put(job.id, { ...entry!.doc, lease_expires_at: Date.now() - 1000 }, { expectedVersion: entry!.version });
    const result = await reclaimOrInterrupt(job.id); // attempt 2 = max → interrupted

    expect(result!.status).toBe("interrupted");
    expect(result!.error).toContain("Max attempts");
  });
});

describe("job-store: cancelJob", () => {
  test("cancels a pending job", async () => {
    const job = await createJob({
      lane: "s1",
      type: "chat_turn",
      payload: {},
      run_id: "r1",
    });

    const ok = await cancelJob(job.id);
    expect(ok).toBe(true);

    const saved = await getJob(job.id);
    expect(saved!.status).toBe("cancelled");
  });

  test("cancels a running job", async () => {
    const job = await createJob({
      lane: "s1",
      type: "chat_turn",
      payload: {},
      run_id: "r1",
    });
    await claimJob(job.id);

    const ok = await cancelJob(job.id);
    expect(ok).toBe(true);

    const saved = await getJob(job.id);
    expect(saved!.status).toBe("cancelled");
  });

  test("refuses to cancel an already completed job", async () => {
    const job = await createJob({
      lane: "s1",
      type: "chat_turn",
      payload: {},
      run_id: "r1",
    });
    await claimJob(job.id);
    await completeJob(job.id, { response: "done" });

    const ok = await cancelJob(job.id);
    expect(ok).toBe(false);
  });
});

describe("job-store: findPendingJobsByLane", () => {
  test("returns pending jobs ordered by priority desc then FIFO by id", async () => {
    const jobLow = await createJob({ lane: "sports", type: "chat_turn", payload: {}, run_id: "r1", priority: 0 });
    const jobHigh = await createJob({ lane: "sports", type: "chat_turn", payload: {}, run_id: "r2", priority: 10 });
    const jobMid = await createJob({ lane: "sports", type: "chat_turn", payload: {}, run_id: "r3", priority: 5 });
    const other = await createJob({ lane: "news", type: "chat_turn", payload: {}, run_id: "r4", priority: 100 });

    const pending = await findPendingJobsByLane("sports");
    expect(pending.length).toBe(3);
    expect(pending[0].id).toBe(jobHigh.id);   // priority 10
    expect(pending[1].id).toBe(jobMid.id);    // priority 5
    expect(pending[2].id).toBe(jobLow.id);    // priority 0
  });

  test("excludes pending jobs with not_before in future", async () => {
    await createJob({ lane: "s1", type: "chat_turn", payload: {}, run_id: "r1" });
    await createJob({ lane: "s1", type: "chat_turn", payload: {}, run_id: "r2", not_before: Date.now() + 60_000 });

    const pending = await findPendingJobsByLane("s1");
    expect(pending.length).toBe(1);
  });
});

describe("job-store: findExpiredLeases", () => {
  test("finds running jobs with expired leases", async () => {
    const job = await createJob({ lane: "s1", type: "chat_turn", payload: {}, run_id: "r1" });
    await claimJob(job.id, "boot-A");

    // Expire the lease
    const c = await col<JobDoc>("jobQueue");
    const entry = await c.get(job.id);
    await c.put(job.id, { ...entry!.doc, lease_expires_at: Date.now() - 1000 }, { expectedVersion: entry!.version });

    const expired = await findExpiredLeases();
    expect(expired.length).toBe(1);
    expect(expired[0].id).toBe(job.id);
  });

  test("excludes jobs with active leases", async () => {
    const job = await createJob({ lane: "s1", type: "chat_turn", payload: {}, run_id: "r1" });
    await claimJob(job.id);

    const expired = await findExpiredLeases();
    expect(expired.length).toBe(0);
  });
});