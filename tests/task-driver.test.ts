/**
 * Tests: TaskDriver — dependency graph + no double-enqueue.
 *
 * 1. Graph A→(B,C)→D with B failing → D ends "blocked", project "failed"
 * 2. Repeated kicks do NOT enqueue duplicate jobs for the same task
 *    (OCC claim pending→queued before enqueue)
 */

process.env.HIVE_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { closeHiveDb } from "../packages/core/src/storage/hivedb";
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap";
import { resetBootId } from "../packages/core/src/storage/boot-id";
import { col, updateDoc, toIndexable } from "../packages/core/src/storage/hive";
import type { TaskDoc, ProjectDoc, JobDoc } from "../packages/core/src/storage/collections";
import { initDurableQueue, registerExecutor, type DurableLaneQueue } from "../packages/core/src/gateway/durable-queue";
import { getTaskDriver, initTaskDriver } from "../packages/core/src/scheduler/task-driver";

let queue: DurableLaneQueue | null = null;

beforeEach(async () => {
  closeHiveDb();
  resetBootId();
  await ensureHiveDb();
  queue = initDurableQueue({ maxGlobalConcurrency: 4 });
});

afterEach(() => {
  queue?.stop();
  queue = null;
  getTaskDriver().stop();
  closeHiveDb();
});

async function seedProject(id: string): Promise<void> {
  const now = Date.now();
  const projectsCol = await col<ProjectDoc>("projects");
  await projectsCol.put(id, {
    id,
    user_id: "test-user",
    agent_id: toIndexable(null),
    name: `Project ${id}`,
    description: null,
    type: "general",
    task: null,
    progress: 0,
    status: "active",
    context: null,
    parent_id: toIndexable(null),
    created_at: now,
    updated_at: now,
    started_at: now,
    completed_at: null,
  }, { expectedVersion: 0 });
}

async function seedTask(id: string, projectId: string, dependsOn: string[] | null): Promise<void> {
  const now = Date.now();
  const tasksCol = await col<TaskDoc>("tasks");
  await tasksCol.put(id, {
    id,
    project_id: projectId,
    agent_id: "worker-1",
    parent_task_id: null,
    name: `Task ${id}`,
    description: `do ${id}`,
    status: "pending",
    progress: 0,
    priority: 0,
    depends_on: dependsOn ? JSON.stringify(dependsOn) : null,
    result: null,
    error: null,
    metadata: null,
    job_id: null,
    run_id: null,
    thread_id: null,
    started_at: null,
    attempts: 0,
    created_at: now,
    updated_at: now,
    completed_at: null,
  }, { expectedVersion: 0 });
}

async function taskStatus(id: string): Promise<string | undefined> {
  const tasksCol = await col<TaskDoc>("tasks");
  return (await tasksCol.get(id))?.doc.status;
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("waitFor timed out");
}

describe("task-driver: dependency graph", () => {
  test("A→(B,C)→D with B failing → D blocked, project failed", async () => {
    await seedProject("proj-1");
    await seedTask("t-A", "proj-1", null);
    await seedTask("t-B", "proj-1", ["t-A"]);
    await seedTask("t-C", "proj-1", ["t-A"]);
    await seedTask("t-D", "proj-1", ["t-B", "t-C"]);

    // Fake executor mirroring the real one's TaskDoc transitions: B fails.
    registerExecutor("project_task", async (job) => {
      const { taskId } = JSON.parse(job.payload_json) as { taskId: string };
      const fail = taskId === "t-B";
      await updateDoc<TaskDoc>("tasks", taskId, fail
        ? { status: "failed", error: "boom", updated_at: Date.now() }
        : { status: "completed", progress: 100, updated_at: Date.now() } as Partial<TaskDoc>);
      // The real executor kicks the driver after finishing
      void getTaskDriver().kick("test:done");
      return fail ? { ok: false, error: "boom" } : { ok: true, result: "done" };
    });

    const driver = getTaskDriver();
    await driver.kick("test:start");

    await waitFor(async () =>
      (await taskStatus("t-A")) === "completed" &&
      (await taskStatus("t-B")) === "failed" &&
      (await taskStatus("t-C")) === "completed" &&
      (await taskStatus("t-D")) === "blocked"
    );

    // One more kick settles the project status
    await driver.kick("test:final");
    const projectsCol = await col<ProjectDoc>("projects");
    const project = (await projectsCol.get("proj-1"))!.doc;
    expect(project.status).toBe("failed");
  });

  test("repeated kicks do not enqueue duplicate jobs (OCC claim)", async () => {
    await seedProject("proj-2");
    await seedTask("t-E", "proj-2", null);

    // Slow executor: the job stays running while we kick again
    registerExecutor("project_task", async (job) => {
      await new Promise((r) => setTimeout(r, 300));
      const { taskId } = JSON.parse(job.payload_json) as { taskId: string };
      await updateDoc<TaskDoc>("tasks", taskId, { status: "completed", progress: 100, updated_at: Date.now() } as Partial<TaskDoc>);
      return { ok: true, result: "done" };
    });

    const driver = getTaskDriver();
    await driver.kick("k1");
    await driver.kick("k2");
    await driver.kick("k3");

    // The task was claimed queued by the first kick — later kicks skip it
    expect(await taskStatus("t-E")).toBe("queued");

    const jobsCol = await col<JobDoc>("jobQueue");
    const jobs = (await jobsCol.findBy("lane", "task:t-E")).map((e) => e.doc);
    expect(jobs.length).toBe(1);

    await waitFor(async () => (await taskStatus("t-E")) === "completed");
  });
});
