/**
 * Tests for gateway/job-store.ts — idempotency_key dedup on createJob:
 * a repeated key returns the existing job (whatever its status) instead of
 * creating a duplicate.
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId } from "../packages/core/src/storage/boot-id";
import { createJob, claimJob, completeJob, findByIdempotencyKey } from "../packages/core/src/gateway/job-store";
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

describe("job-store: idempotency_key", () => {
  test("two createJob calls with the same key return the same job", async () => {
    const first = await createJob({ lane: "s1", type: "worker_task", payload: { n: 1 }, run_id: "r1", idempotency_key: "dedupe-me" });
    const second = await createJob({ lane: "s1", type: "worker_task", payload: { n: 2 }, run_id: "r1", idempotency_key: "dedupe-me" });

    expect(second.id).toBe(first.id);
    // Second call's payload never gets persisted — the original wins.
    expect(JSON.parse(second.payload_json).n).toBe(1);

    const c = await col<JobDoc>("jobQueue");
    const all = await c.scan();
    expect(all.filter((e) => e.doc.type === "worker_task").length).toBe(1);
  });

  test("returns the cached result once the original job has completed", async () => {
    const job = await createJob({ lane: "s1", type: "worker_task", payload: {}, run_id: "r1", idempotency_key: "k1" });
    await claimJob(job.id);
    await completeJob(job.id, { done: true });

    const repeat = await createJob({ lane: "s1", type: "worker_task", payload: {}, run_id: "r1", idempotency_key: "k1" });
    expect(repeat.id).toBe(job.id);
    expect(repeat.status).toBe("completed");
    expect(JSON.parse(repeat.result_json!)).toEqual({ done: true });
  });

  test("jobs without an idempotency_key are never deduped against each other", async () => {
    const a = await createJob({ lane: "s1", type: "worker_task", payload: {}, run_id: "r1" });
    const b = await createJob({ lane: "s1", type: "worker_task", payload: {}, run_id: "r2" });
    expect(a.id).not.toBe(b.id);
  });

  test("findByIdempotencyKey returns null for an unknown key", async () => {
    const result = await findByIdempotencyKey("does-not-exist");
    expect(result).toBeNull();
  });

  test("different keys create distinct jobs", async () => {
    const a = await createJob({ lane: "s1", type: "worker_task", payload: {}, run_id: "r1", idempotency_key: "key-a" });
    const b = await createJob({ lane: "s1", type: "worker_task", payload: {}, run_id: "r2", idempotency_key: "key-b" });
    expect(a.id).not.toBe(b.id);
  });
});
