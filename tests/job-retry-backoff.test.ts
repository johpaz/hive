/**
 * Tests for gateway/job-store.ts — failJobOrRetry: logical-failure retries
 * with exponential backoff + jitter, separate from `attempts` (crash/lease
 * only). Plus DurableLaneQueue wiring: chat_turn never retries, other types
 * retry via the queue when the executor returns retryable:false-or-absent.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId, getBootId } from "../packages/core/src/storage/boot-id";
import {
  createJob,
  claimJob,
  failJobOrRetry,
  getJob,
  computeBackoffDelay,
  type JobRetryPolicy,
} from "../packages/core/src/gateway/job-store";
import { DurableLaneQueue, registerExecutor } from "../packages/core/src/gateway/durable-queue";
import { col } from "../packages/core/src/storage/hive";
import type { JobDoc } from "../packages/core/src/storage/collections";

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
});

afterEach(() => {
  closeHiveDb();
});

const FAST_POLICY: JobRetryPolicy = {
  maxRetries: 2,
  initialDelayMs: 10,
  backoffMultiplier: 2,
  maxDelayMs: 1000,
  jitter: 0,
};

describe("job-store: computeBackoffDelay", () => {
  test("grows exponentially and caps at maxDelayMs", () => {
    const policy: JobRetryPolicy = { maxRetries: 10, initialDelayMs: 100, backoffMultiplier: 2, maxDelayMs: 500, jitter: 0 };
    expect(computeBackoffDelay(0, policy)).toBe(100);
    expect(computeBackoffDelay(1, policy)).toBe(200);
    expect(computeBackoffDelay(2, policy)).toBe(400);
    expect(computeBackoffDelay(3, policy)).toBe(500); // capped
    expect(computeBackoffDelay(10, policy)).toBe(500); // still capped
  });

  test("jitter adds a bounded random amount on top of the base delay", () => {
    const policy: JobRetryPolicy = { maxRetries: 10, initialDelayMs: 100, backoffMultiplier: 2, maxDelayMs: 10_000, jitter: 0.5 };
    for (let i = 0; i < 20; i++) {
      const delay = computeBackoffDelay(0, policy);
      expect(delay).toBeGreaterThanOrEqual(100);
      expect(delay).toBeLessThanOrEqual(150);
    }
  });
});

describe("job-store: failJobOrRetry", () => {
  test("schedules a retry: pending with a future not_before, retry_count incremented", async () => {
    const job = await createJob({ lane: "s1", type: "worker_task", payload: {}, run_id: "r1" });
    await claimJob(job.id);

    const before = Date.now();
    const result = await failJobOrRetry(job.id, "transient error", getBootId(), FAST_POLICY);

    expect(result).not.toBeNull();
    expect(result!.status).toBe("pending");
    expect(result!.retry_count).toBe(1);
    expect(result!.last_error).toBe("transient error");
    expect(result!.not_before).toBeGreaterThan(before);
    expect(result!.boot_id).toBeNull();
    expect(result!.lease_expires_at).toBeNull();

    const fromDb = await getJob(job.id);
    expect(fromDb!.status).toBe("pending");
  });

  test("does not touch `attempts` (crash counter) — only `retry_count`", async () => {
    const job = await createJob({ lane: "s1", type: "worker_task", payload: {}, run_id: "r1" });
    const claimed = await claimJob(job.id);
    expect(claimed!.attempts).toBe(1);

    const result = await failJobOrRetry(job.id, "boom", getBootId(), FAST_POLICY);
    expect(result!.attempts).toBe(1); // unchanged
    expect(result!.retry_count).toBe(1);
  });

  test("fails terminally once retry_count reaches policy.maxRetries", async () => {
    const job = await createJob({ lane: "s1", type: "worker_task", payload: {}, run_id: "r1" });
    const c = await col<JobDoc>("jobQueue");

    // Exhaust retries one at a time (each retry re-pends the job; re-claim before the next failure).
    // Force not_before into the past after each retry so claimJob doesn't block on the backoff delay.
    for (let i = 0; i < FAST_POLICY.maxRetries; i++) {
      await claimJob(job.id);
      const r = await failJobOrRetry(job.id, `attempt ${i}`, getBootId(), FAST_POLICY);
      expect(r!.status).toBe("pending");
      const entry = await c.get(job.id);
      await c.put(job.id, { ...entry!.doc, not_before: Date.now() - 1 }, { expectedVersion: entry!.version });
    }

    await claimJob(job.id);
    const final = await failJobOrRetry(job.id, "final failure", getBootId(), FAST_POLICY);
    expect(final!.status).toBe("failed");
    expect(final!.error).toBe("final failure");
    expect(final!.last_error).toBe("final failure");
  });

  test("ignores a job owned by a different boot_id", async () => {
    const job = await createJob({ lane: "s1", type: "worker_task", payload: {}, run_id: "r1" });
    await claimJob(job.id, "boot-A");

    const result = await failJobOrRetry(job.id, "err", "boot-B", FAST_POLICY);
    expect(result).toBeNull();

    const fromDb = await getJob(job.id);
    expect(fromDb!.status).toBe("running");
  });
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor timed out");
}

describe("durable-queue: retry-on-logical-failure wiring", () => {
  let queue: DurableLaneQueue | null = null;

  afterEach(() => {
    queue?.stop();
    queue = null;
  });

  test("a retryable logical failure eventually completes after retrying", async () => {
    let calls = 0;
    registerExecutor("worker_task", async () => {
      calls++;
      if (calls < 2) return { ok: false, error: "flaky", retryable: true };
      return { ok: true, result: "recovered" };
    });

    queue = new DurableLaneQueue({ maxGlobalConcurrency: 2, jobRetryPolicy: FAST_POLICY });
    const job = await queue.enqueue({ lane: "task:retry-1", type: "worker_task", run_id: "r1", payload: {} });

    // Wait past the (10ms) backoff delay, then use the public start() — it
    // re-dispatches any due-pending lane — instead of the real 10s timer.
    // The extra buffer avoids racing the exact not_before boundary.
    await waitFor(async () => (await getJob(job.id))?.status === "pending" && (await getJob(job.id))!.retry_count === 1);
    await new Promise((r) => setTimeout(r, 30));
    queue.start();

    await waitFor(async () => (await getJob(job.id))?.status === "completed");
    const final = await getJob(job.id);
    expect(calls).toBe(2);
    expect(final!.status).toBe("completed");
    expect(JSON.parse(final!.result_json!)).toBe("recovered");
  });

  test("chat_turn jobs never auto-retry a logical failure", async () => {
    let calls = 0;
    registerExecutor("chat_turn", async () => {
      calls++;
      return { ok: false, error: "user-facing failure" };
    });

    queue = new DurableLaneQueue({ maxGlobalConcurrency: 2, jobRetryPolicy: FAST_POLICY });
    const job = await queue.enqueue({ lane: "session-1", type: "chat_turn", run_id: "r1", payload: {} });

    await waitFor(async () => (await getJob(job.id))?.status === "failed");
    expect(calls).toBe(1);
    const final = await getJob(job.id);
    expect(final!.retry_count).toBe(0);
  });
});
