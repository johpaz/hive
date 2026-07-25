process.env.HIVE_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { col } from "../packages/core/src/storage/hive";
import type { JobDoc } from "../packages/core/src/storage/collections";
import {
  registerExecutor,
  initDurableQueue,
  type DurableLaneQueue,
  type JobExecutorResult,
} from "../packages/core/src/gateway/durable-queue";
import { initDelegationNotify } from "../packages/core/src/gateway/delegation-notify";

let nextOutcome: JobExecutorResult = { ok: true, result: "done" };
let dq: DurableLaneQueue | null = null;

beforeEach(async () => {
  closeHiveDb();
  await ensureHiveDb();
  registerExecutor("worker_task", async () => nextOutcome);
  initDelegationNotify();
});

afterEach(() => {
  dq?.stop();
  dq = null;
  closeHiveDb();
});

async function findTaskCompleteJobs(): Promise<Array<{ job: JobDoc; payload: any }>> {
  const jobs = await col<JobDoc>("jobQueue");
  const all = (await jobs.scan({})).map((e) => e.doc);
  return all
    .filter((j) => j.type === "chat_turn")
    .map((job) => ({ job, payload: JSON.parse(job.payload_json) }))
    .filter((row) => row.payload.source === "task_complete");
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("delegation-notify", () => {
  test("a completed worker_task enqueues exactly one task_complete chat_turn in the origin lane", async () => {
    nextOutcome = { ok: true, result: "Reporte listo" };
    dq = initDurableQueue();

    await dq.enqueue({
      lane: "task:t1",
      type: "worker_task",
      run_id: "run1",
      payload: { taskName: "Investigar X", originThreadId: "webchat:sess-1" },
    });

    await waitFor(async () => (await findTaskCompleteJobs()).length > 0);
    const notices = await findTaskCompleteJobs();
    expect(notices).toHaveLength(1);
    expect(notices[0].job.lane).toBe("sess-1");
    expect(notices[0].payload.sessionId).toBe("sess-1");
    expect(notices[0].payload.content).toContain("Investigar X");
    expect(notices[0].payload.content).toContain("Reporte listo");
    // No manual framing — persisted with source:"task_complete" and framed
    // at serialization time by formatInternalEvent, not baked into content.
    expect(notices[0].payload.content).not.toContain("[Sistema]");
    expect(notices[0].payload.source).toBe("task_complete");
  });

  test("a worker_task without originThreadId (no origin conversation) does not notify", async () => {
    nextOutcome = { ok: true, result: "done" };
    dq = initDurableQueue();

    await dq.enqueue({
      lane: "task:t2",
      type: "worker_task",
      run_id: "run2",
      payload: { taskName: "Sin origen" },
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(await findTaskCompleteJobs()).toHaveLength(0);
  });

  test("a retryable failure that has not exhausted retries does not notify yet", async () => {
    nextOutcome = { ok: false, error: "transient", retryable: true };
    dq = initDurableQueue({
      jobRetryPolicy: { maxRetries: 3, initialDelayMs: 60_000, backoffMultiplier: 2, maxDelayMs: 60_000, jitter: 0 },
    });

    await dq.enqueue({
      lane: "task:t3",
      type: "worker_task",
      run_id: "run3",
      payload: { taskName: "Fallo transitorio", originThreadId: "webchat:sess-3" },
    });

    // Give the single attempt time to run and requeue (not_before far in the future).
    await new Promise((r) => setTimeout(r, 150));

    const jobs = await col<JobDoc>("jobQueue");
    const t3 = (await jobs.findBy("lane", "task:t3"))[0]?.doc;
    expect(t3?.status).toBe("pending"); // requeued, not terminal
    expect(await findTaskCompleteJobs()).toHaveLength(0);
  });

  test("a terminal failure (retries exhausted) notifies with the error", async () => {
    nextOutcome = { ok: false, error: "no se pudo completar", retryable: true };
    dq = initDurableQueue({
      jobRetryPolicy: { maxRetries: 0, initialDelayMs: 1, backoffMultiplier: 1, maxDelayMs: 1, jitter: 0 },
    });

    await dq.enqueue({
      lane: "task:t4",
      type: "worker_task",
      run_id: "run4",
      payload: { taskName: "Tarea imposible", originThreadId: "webchat:sess-4" },
    });

    await waitFor(async () => (await findTaskCompleteJobs()).length > 0);
    const notices = await findTaskCompleteJobs();
    expect(notices).toHaveLength(1);
    expect(notices[0].job.lane).toBe("sess-4");
    expect(notices[0].payload.content).toContain("no se pudo completar");
  });
});
