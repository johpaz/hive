/**
 * Tests: CronScheduler misfire catch-up (Fase 6).
 *
 * 1. one-shot fire_once within grace → handler executes at boot
 * 2. one-shot outside grace → status "failed", never executes
 * 3. one-shot with skip policy → status "failed", never executes
 * 4. recurring with next_run_at in the past (skip) → stays active with
 *    last_error, re-schedules via Croner
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId } from "../packages/core/src/storage/boot-id";
import { col, toIndexable } from "../packages/core/src/storage/hive";
import type { CronJobDoc } from "../packages/core/src/storage/collections";
import { CronScheduler } from "../packages/core/src/scheduler/CronScheduler";

let scheduler: CronScheduler | null = null;

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
});

afterEach(() => {
  scheduler?.shutdown();
  scheduler = null;
  closeHiveDb();
});

function baseCronDoc(over: Partial<CronJobDoc>): CronJobDoc {
  const now = new Date().toISOString();
  return {
    id: over.id ?? "job-x",
    name: over.name ?? "test job",
    task: "do something",
    task_type: "one_shot",
    cron_expression: null,
    fire_at: null,
    timezone: "UTC",
    start_at: null,
    stop_at: null,
    dom_and_dow: 0,
    max_runs: null,
    protect: 0,
    interval_sec: null,
    agent_id: toIndexable(null),
    channel: "webchat",
    payload: "{}",
    tool_name: null,
    status: "active",
    run_count: 0,
    error_count: 0,
    last_error: null,
    misfire_policy: "skip",
    misfire_grace_min: 60,
    created_at: now,
    updated_at: now,
    last_run_at: null,
    next_run_at: null,
    completed_at: null,
    ...over,
  };
}

async function seed(doc: CronJobDoc): Promise<void> {
  const cronJobsCol = await col<CronJobDoc>("cronJobs");
  await cronJobsCol.put(doc.id, doc, { expectedVersion: 0 });
}

async function getDoc(id: string): Promise<CronJobDoc | null> {
  const cronJobsCol = await col<CronJobDoc>("cronJobs");
  const entry = await cronJobsCol.get(id);
  return entry ? entry.doc : null;
}

describe("cron misfire catch-up", () => {
  test("one-shot fire_once within grace executes at boot", async () => {
    const fired: string[] = [];
    await seed(baseCronDoc({
      id: "os-grace",
      task_type: "one_shot",
      fire_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
      misfire_policy: "fire_once",
      misfire_grace_min: 60,
    }));

    scheduler = new CronScheduler(async (job) => {
      fired.push(job.id);
      return { success: true, response: "ok" };
    });
    await scheduler.boot();

    // Catch-up execution is fire-and-forget — give it a beat
    const start = Date.now();
    while (fired.length === 0 && Date.now() - start < 3000) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(fired).toContain("os-grace");
  });

  test("one-shot fire_once outside grace → failed, never executes", async () => {
    const fired: string[] = [];
    await seed(baseCronDoc({
      id: "os-late",
      task_type: "one_shot",
      fire_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
      misfire_policy: "fire_once",
      misfire_grace_min: 60,
    }));

    scheduler = new CronScheduler(async (job) => {
      fired.push(job.id);
      return { success: true };
    });
    await scheduler.boot();
    await new Promise((r) => setTimeout(r, 200));

    const doc = await getDoc("os-late");
    expect(doc!.status).toBe("failed");
    expect(doc!.last_error).toContain("Missed while down");
    expect(fired).not.toContain("os-late");
  });

  test("one-shot with skip policy → failed, never executes", async () => {
    const fired: string[] = [];
    await seed(baseCronDoc({
      id: "os-skip",
      task_type: "one_shot",
      fire_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 min ago
      misfire_policy: "skip",
    }));

    scheduler = new CronScheduler(async (job) => {
      fired.push(job.id);
      return { success: true };
    });
    await scheduler.boot();
    await new Promise((r) => setTimeout(r, 200));

    const doc = await getDoc("os-skip");
    expect(doc!.status).toBe("failed");
    expect(fired).not.toContain("os-skip");
  });

  test("recurring with next_run_at in the past (skip) stays active with last_error", async () => {
    await seed(baseCronDoc({
      id: "rec-skip",
      task_type: "recurring",
      cron_expression: "*/5 * * * *",
      fire_at: null,
      next_run_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      misfire_policy: "skip",
    }));

    scheduler = new CronScheduler(async () => ({ success: true }));
    await scheduler.boot();

    const doc = await getDoc("rec-skip");
    expect(doc!.status).toBe("active");
    expect(doc!.last_error).toContain("Missed run");
  });
});
