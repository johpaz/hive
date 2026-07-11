/**
 * Hive CronScheduler
 *
 * Croner-based scheduler for Hive with HiveDB persistence.
 * Manages recurring and one-shot cron jobs that execute through the agent pipeline.
 */

import { Cron } from "croner";
import { logger } from "../utils/logger";
import { notifyTaskCompletion } from "./integration";
import { col, toIndexable, fromIndexable } from "../storage/hive";
import type { CronJobDoc, TaskRunDoc } from "../storage/collections";
import type {
  CronJob,
  TaskRun,
  CreateCronJobInput,
  UpdateCronJobInput,
  CronJobStatus,
  CronJobExecutionHandler,
} from "./types";

const log = logger.child("CronScheduler");

function fromDoc(doc: CronJobDoc): CronJob {
  return { ...doc, agent_id: fromIndexable(doc.agent_id) };
}

function toDoc(job: CronJob): CronJobDoc {
  return { ...job, agent_id: toIndexable(job.agent_id) };
}

export class CronScheduler {
  private jobs: Map<string, Cron> = new Map();
  private handler: CronJobExecutionHandler;
  private cleanupTaskId: string | null = null;

  constructor(handler: CronJobExecutionHandler) {
    this.handler = handler;
  }

  /**
   * Boot the scheduler - load all active jobs from DB and activate them.
   * Also detects misfires (next_run_at/fire_at in the past) and handles
   * them according to misfire_policy.
   */
  async boot(): Promise<void> {
    const cronJobsCol = await col<CronJobDoc>("cronJobs");
    const tasks = (await cronJobsCol.findBy("status", "active")).map(e => fromDoc(e.doc));

    const now = new Date();
    let misfireCount = 0;

    for (const task of tasks) {
      // ── Misfire detection ──────────────────────────────────────────────
      const misfirePolicy = task.misfire_policy ?? "skip";
      const graceMin = task.misfire_grace_min ?? 60;
      const graceCutoff = new Date(now.getTime() - graceMin * 60 * 1000);

      let misfireTime: Date | null = null;
      if (task.task_type === "recurring" && task.next_run_at) {
        const nextRun = new Date(task.next_run_at);
        if (nextRun < now) {
          misfireTime = nextRun;
        }
      } else if (task.task_type === "one_shot" && task.fire_at) {
        const fireAt = new Date(task.fire_at);
        if (fireAt < now) {
          misfireTime = fireAt;
        }
      }

      if (misfireTime) {
        misfireCount++;
        const withinGrace = misfireTime >= graceCutoff;

        if (misfirePolicy === "fire_once" && withinGrace) {
          log.info(`[boot:misfire] Job "${task.name}" (${task.id}) misfired at ${misfireTime.toISOString()} — executing now (fire_once, within grace)`);
          // Activate the job first (so the Croner handle exists for future runs)
          await this.activate(task);
          // Then execute it immediately
          this.execute(task.id).catch((err) => {
            log.error(`[boot:misfire] Catch-up execution failed for "${task.name}": ${(err as Error).message}`);
          });
        } else if (misfirePolicy === "fire_once" && !withinGrace) {
          log.warn(`[boot:misfire] Job "${task.name}" (${task.id}) misfired at ${misfireTime.toISOString()} — outside grace window (${graceMin}min), skipping catch-up`);
          if (task.task_type === "recurring") {
            await this.updateJob(task.id, {
              last_error: `Missed run at ${misfireTime.toISOString()} (outside grace)`,
              updated_at: now.toISOString(),
            });
          }
          await this.activate(task);
        } else {
          // skip policy
          log.info(`[boot:misfire] Job "${task.name}" (${task.id}) misfired at ${misfireTime.toISOString()} — skipping (misfire_policy=skip)`);
          await this.updateJob(task.id, {
            last_error: `Missed run at ${misfireTime.toISOString()} (policy: skip)`,
            updated_at: now.toISOString(),
          });
          await this.activate(task);
        }
      } else {
        // No misfire — activate normally
        await this.activate(task);
      }
    }

    log.info(`[boot] Loaded ${tasks.length} active job(s)${misfireCount > 0 ? `, ${misfireCount} misfire(s) detected` : ""}`);

    await this.ensureCleanupTask();
  }

  /**
   * Activate a cron job - create or recreate its Croner instance
   */
  async activate(task: CronJob): Promise<void> {
    const existingJob = this.jobs.get(task.id);
    if (existingJob) {
      existingJob.stop();
      this.jobs.delete(task.id);
      log.debug(`[activate] Stopped existing job for task "${task.name}" (${task.id})`);
    }

    if (task.status === "paused" || task.status === "completed" || task.status === "cancelled") {
      log.debug(`[activate] Skipping job "${task.name}" (${task.id}) - status: ${task.status}`);
      return;
    }

    // Fix 2A: auto-pause jobs that exceeded the error threshold
    const MAX_ERRORS = 5;
    const cronJobsCol = await col<CronJobDoc>("cronJobs");
    if (task.error_count >= MAX_ERRORS) {
      await this.updateJob(task.id, {
        status: "paused",
        last_error: `Auto-paused after ${MAX_ERRORS} consecutive errors`,
        updated_at: new Date().toISOString(),
      });
      log.warn(`[activate] Job "${task.name}" (${task.id}) auto-paused (error_count=${task.error_count})`);
      return;
    }

    try {
      let pattern: string;
      if (task.task_type === "recurring") {
        if (!task.cron_expression) {
          log.error(`[activate] Job "${task.name}" (${task.id}) is recurring but has no cron_expression`);
          return;
        }
        pattern = task.cron_expression;
      } else {
        if (!task.fire_at) {
          log.error(`[activate] Job "${task.name}" (${task.id}) is one_shot but has no fire_at`);
          return;
        }
        pattern = task.fire_at;
      }

      try {
        new Cron(pattern);
      } catch (err) {
        log.error(`[activate] Invalid cron pattern "${pattern}" for job "${task.name}": ${(err as Error).message}`);
        return;
      }

      const options: any = {
        timezone: task.timezone,
        protect: task.protect === 1,
        catch: (error: Error) => this.handleError(task, error),
        name: task.name,
        domAndDow: task.dom_and_dow === 1,
      };

      if (task.max_runs !== null && task.max_runs !== undefined) {
        options.maxRuns = task.max_runs;
      }

      if (task.interval_sec !== null && task.interval_sec !== undefined) {
        options.interval = task.interval_sec;
      }

      if (task.start_at) {
        options.startAt = task.start_at;
      }

      if (task.stop_at) {
        options.stopAt = task.stop_at;
      }

      // Fix 1: pass only the ID so execute always reads fresh data from DB
      const cron = new Cron(
        pattern,
        options,
        () => this.execute(task.id)
      );

      this.jobs.set(task.id, cron);

      const nextRun = cron.nextRun();
      if (nextRun) {
        const nextRunIso = nextRun.toISOString();
        // Fix 4: also update updated_at when writing next_run_at
        await this.updateJob(task.id, { next_run_at: nextRunIso, updated_at: new Date().toISOString() });
        log.info(`[activate] Job "${task.name}" (${task.id}) scheduled - next: ${nextRunIso}`);
      } else {
        log.warn(`[activate] Job "${task.name}" (${task.id}) has no next run date`);
      }
    } catch (err) {
      log.error(`[activate] Failed to activate job "${task.name}" (${task.id}): ${(err as Error).message}`);
    }
  }

  /** Read-modify-write helper for cron_jobs partial updates, retrying on OCC conflict. */
  private async updateJob(taskId: string, patch: Partial<CronJobDoc>): Promise<CronJobDoc | null> {
    const cronJobsCol = await col<CronJobDoc>("cronJobs");
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await cronJobsCol.get(taskId);
      if (!existing) return null;
      const merged = { ...existing.doc, ...patch };
      try {
        await cronJobsCol.put(taskId, merged, { expectedVersion: existing.version });
        return merged;
      } catch {
        // Version conflict — retry with a fresh read.
      }
    }
    throw new Error(`CronScheduler.updateJob: too much contention on cronJobs/${taskId}`);
  }

  /**
   * Execute a cron job - run it through the agent pipeline
   */
  private async execute(taskId: string): Promise<void> {
    // Fix 1: read fresh task data from DB to avoid stale closure snapshots
    const cronJobsCol = await col<CronJobDoc>("cronJobs");
    const taskEntry = await cronJobsCol.get(taskId);
    if (!taskEntry) {
      log.warn(`[execute] Job "${taskId}" not found in DB — skipping`);
      return;
    }
    const task = fromDoc(taskEntry.doc);

    const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const startedAt = new Date().toISOString();
    const startTime = performance.now();

    log.info(`[execute] Starting job "${task.name}" (${task.id}) run #${runId}`);

    const taskRunsCol = await col<TaskRunDoc>("taskRuns");
    try {
      await taskRunsCol.put(runId, {
        id: runId,
        task_id: task.id,
        status: "running",
        started_at: startedAt,
        finished_at: null,
        duration_ms: null,
        error_message: null,
        payload_snapshot: task.payload,
        agent_response: null,
      }, { expectedVersion: 0 });
    } catch (err) {
      log.error(`[execute] Failed to create task_run record: ${(err as Error).message}`);
    }

    try {
      const result = await this.handler(task);
      const duration = performance.now() - startTime;
      const finishedAt = new Date().toISOString();

      if (result.success) {
        await this.updateTaskRun(runId, {
          status: "success",
          finished_at: finishedAt,
          duration_ms: Math.round(duration),
          agent_response: result.response?.slice(0, 1000) || null,
        });

        const refreshed = await this.updateJob(task.id, {
          run_count: task.run_count + 1,
          last_run_at: finishedAt,
          last_error: null,
        });

        const job = this.jobs.get(task.id);
        if (job) {
          const nextRun = job.nextRun();
          if (nextRun) {
            await this.updateJob(task.id, { next_run_at: nextRun.toISOString() });
          }
        }

        await notifyTaskCompletion(task.id, task.name, true, result.response);

        if (task.task_type === "one_shot") {
          await this.updateJob(task.id, { status: "completed", completed_at: finishedAt });
          this.deactivate(task.id);
          log.info(`[execute] One-shot job "${task.name}" (${task.id}) completed`);
        } else {
          log.info(`[execute] Job "${task.name}" (${task.id}) completed in ${Math.round(duration)}ms`);
        }
      } else {
        throw new Error(result.error || "Handler reported failure");
      }
    } catch (err) {
      const duration = performance.now() - startTime;
      const finishedAt = new Date().toISOString();
      const errorMessage = (err as Error).message;

      await this.updateTaskRun(runId, {
        status: "failed",
        finished_at: finishedAt,
        duration_ms: Math.round(duration),
        error_message: errorMessage,
      });

      const updated = await this.updateJob(task.id, {
        error_count: task.error_count + 1,
        last_error: errorMessage,
      });

      log.error(`[execute] Job "${task.name}" (${task.id}) failed: ${errorMessage}`);

      // Fix 2B: auto-pause if error threshold reached
      const MAX_ERRORS = 5;
      if (updated && updated.error_count >= MAX_ERRORS) {
        await this.updateJob(task.id, { status: "paused", updated_at: new Date().toISOString() });
        this.deactivate(task.id);
        log.warn(`[execute] Job "${task.name}" (${task.id}) auto-paused after ${MAX_ERRORS} errors`);
      }

      await notifyTaskCompletion(task.id, task.name, false, undefined, errorMessage);
    }
  }

  /** Read-modify-write helper for task_runs partial updates, retrying on OCC conflict. */
  private async updateTaskRun(runId: string, patch: Partial<TaskRunDoc>): Promise<void> {
    const taskRunsCol = await col<TaskRunDoc>("taskRuns");
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await taskRunsCol.get(runId);
      if (!existing) return;
      try {
        await taskRunsCol.put(runId, { ...existing.doc, ...patch }, { expectedVersion: existing.version });
        return;
      } catch {
        // Version conflict — retry with a fresh read.
      }
    }
    log.warn(`[updateTaskRun] Too much contention on taskRuns/${runId}`);
  }

  /**
   * Handle errors from Croner
   */
  private handleError(task: CronJob, error: Error): void {
    log.error(`[error] Job "${task.name}" (${task.id}) error: ${error.message}`);

    // Fix 3: record Croner-level errors in task_runs for full history
    Promise.resolve().then(async () => {
      const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const now = new Date().toISOString();
      try {
        const taskRunsCol = await col<TaskRunDoc>("taskRuns");
        await taskRunsCol.put(runId, {
          id: runId,
          task_id: task.id,
          status: "failed",
          started_at: now,
          finished_at: now,
          duration_ms: 0,
          error_message: error.message,
          payload_snapshot: null,
          agent_response: null,
        }, { expectedVersion: 0 });
      } catch (e) {
        log.warn(`[handleError] Failed to insert task_run: ${(e as Error).message}`);
      }

      await this.updateJob(task.id, {
        error_count: task.error_count + 1,
        last_error: error.message,
      });
    });
  }

  /**
   * Pause a cron job
   */
  async pause(taskId: string): Promise<boolean> {
    const job = this.jobs.get(taskId);
    if (job) {
      job.pause();
    }

    const updated = await this.updateJob(taskId, { status: "paused" });

    if (updated) {
      log.info(`[pause] Job "${taskId}" paused`);
      return true;
    }

    log.warn(`[pause] Job "${taskId}" not found`);
    return false;
  }

  /**
   * Resume a paused cron job
   */
  async resume(taskId: string): Promise<boolean> {
    const cronJobsCol = await col<CronJobDoc>("cronJobs");
    const taskEntry = await cronJobsCol.get(taskId);

    if (!taskEntry) {
      log.warn(`[resume] Job "${taskId}" not found`);
      return false;
    }

    const updated = await this.updateJob(taskId, { status: "active" });

    await this.activate(fromDoc(updated!));
    log.info(`[resume] Job "${taskId}" resumed`);
    return true;
  }

  /**
   * Deactivate a cron job - stop Croner instance but keep in DB
   */
  deactivate(taskId: string): void {
    const job = this.jobs.get(taskId);
    if (job) {
      job.stop();
      this.jobs.delete(taskId);
      log.debug(`[deactivate] Job "${taskId}" deactivated`);
    }
  }

  /**
   * Delete a cron job - deactivate and remove from DB
   */
  async delete(taskId: string): Promise<boolean> {
    this.deactivate(taskId);

    const cronJobsCol = await col<CronJobDoc>("cronJobs");
    const existing = await cronJobsCol.get(taskId);
    if (!existing) {
      log.warn(`[delete] Job "${taskId}" not found`);
      return false;
    }

    await cronJobsCol.delete(taskId);
    log.info(`[delete] Job "${taskId}" deleted`);
    return true;
  }

  /**
   * Create a new cron job
   */
  async create(input: CreateCronJobInput): Promise<{ id: string; nextRun?: string }> {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = new Date().toISOString();

    if (input.task_type === "recurring") {
      if (!input.cron_expression) {
        throw new Error("recurring task requires cron_expression");
      }
      try {
        new Cron(input.cron_expression);
      } catch (err) {
        throw new Error(`Invalid cron expression: ${(err as Error).message}`);
      }
    }

    if (input.task_type === "one_shot") {
      if (!input.fire_at) {
        throw new Error("one_shot task requires fire_at");
      }
      const fireAt = new Date(input.fire_at);
      if (fireAt.getTime() <= Date.now()) {
        throw new Error("fire_at must be in the future");
      }
    }

    try {
      new Intl.DateTimeFormat(undefined, { timeZone: input.timezone });
    } catch (err) {
      throw new Error(`Invalid timezone: ${input.timezone}`);
    }

    const payloadJson = input.payload ? JSON.stringify(input.payload) : "{}";
    try {
      JSON.parse(payloadJson);
    } catch (err) {
      throw new Error("Invalid payload JSON");
    }

    const doc: CronJobDoc = {
      id,
      name: input.name,
      task: input.task,
      task_type: input.task_type,
      cron_expression: input.cron_expression || null,
      fire_at: input.fire_at || null,
      timezone: input.timezone,
      start_at: input.start_at || null,
      stop_at: input.stop_at || null,
      dom_and_dow: input.dom_and_dow ? 1 : 0,
      max_runs: input.max_runs || null,
      protect: input.protect !== false ? 1 : 0,
      interval_sec: input.interval_sec || null,
      agent_id: toIndexable(input.agent_id || null),
      channel: input.channel || "system",
      payload: payloadJson,
      tool_name: input.tool_name || null,
      status: "active",
      run_count: 0,
      error_count: 0,
      last_error: null,
      misfire_policy: input.misfire_policy ?? "skip",
      misfire_grace_min: input.misfire_grace_min ?? 60,
      created_at: now,
      updated_at: now,
      last_run_at: null,
      next_run_at: null,
      completed_at: null,
    };

    const cronJobsCol = await col<CronJobDoc>("cronJobs");
    await cronJobsCol.put(id, doc, { expectedVersion: 0 });

    await this.activate(fromDoc(doc));

    const job = this.jobs.get(id);
    const nextRun = job?.nextRun()?.toISOString();

    log.info(`[create] Job "${input.name}" (${id}) created`);

    return { id, nextRun };
  }

  /**
   * Update an existing cron job
   */
  async update(taskId: string, changes: UpdateCronJobInput): Promise<boolean> {
    const cronJobsCol = await col<CronJobDoc>("cronJobs");
    const taskEntry = await cronJobsCol.get(taskId);

    if (!taskEntry) {
      log.warn(`[update] Job "${taskId}" not found`);
      return false;
    }

    const patch: Partial<CronJobDoc> = {};

    if (changes.name !== undefined) patch.name = changes.name;
    if (changes.task !== undefined) patch.task = changes.task;
    if (changes.task_type !== undefined) patch.task_type = changes.task_type;
    if (changes.cron_expression !== undefined) patch.cron_expression = changes.cron_expression;
    if (changes.fire_at !== undefined) patch.fire_at = changes.fire_at;
    if (changes.timezone !== undefined) patch.timezone = changes.timezone;
    if (changes.start_at !== undefined) patch.start_at = changes.start_at;
    if (changes.stop_at !== undefined) patch.stop_at = changes.stop_at;
    if (changes.dom_and_dow !== undefined) patch.dom_and_dow = changes.dom_and_dow ? 1 : 0;
    if (changes.agent_id !== undefined) patch.agent_id = toIndexable(changes.agent_id);
    if (changes.channel !== undefined) patch.channel = changes.channel;
    if (changes.payload !== undefined) patch.payload = JSON.stringify(changes.payload);
    if (changes.tool_name !== undefined) patch.tool_name = changes.tool_name;
    if (changes.max_runs !== undefined) patch.max_runs = changes.max_runs;
    if (changes.protect !== undefined) patch.protect = changes.protect ? 1 : 0;
    if (changes.interval_sec !== undefined) patch.interval_sec = changes.interval_sec;
    if (changes.status !== undefined) patch.status = changes.status;

    if (Object.keys(patch).length === 0) {
      return true;
    }

    const updatedDoc = await this.updateJob(taskId, patch);

    await this.activate(fromDoc(updatedDoc!));

    log.info(`[update] Job "${taskId}" updated`);
    return true;
  }

  /**
   * Get status of all cron jobs
   */
  async getStatus(): Promise<CronJobStatus[]> {
    const cronJobsCol = await col<CronJobDoc>("cronJobs");
    const tasks = (await cronJobsCol.scan({})).map(e => e.doc).sort((a, b) => a.id.localeCompare(b.id));

    return tasks.map((task) => {
      const job = this.jobs.get(task.id);
      return {
        id: task.id,
        name: task.name,
        nextRun: job?.nextRun() || null,
        isBusy: job?.isBusy() || false,
        status: task.status as any,
      };
    });
  }

  /**
   * Manually trigger a cron job execution
   */
  trigger(taskId: string): boolean {
    const job = this.jobs.get(taskId);
    if (!job) {
      log.warn(`[trigger] Job "${taskId}" has no active job`);
      return false;
    }

    job.trigger();
    log.info(`[trigger] Job "${taskId}" manually triggered`);
    return true;
  }

  /**
   * Shutdown the scheduler - stop all jobs
   */
  shutdown(): void {
    for (const [id, job] of this.jobs.entries()) {
      job.stop();
    }
    this.jobs.clear();
    log.info("[shutdown] All jobs stopped");
  }

  /**
   * Ensure the cleanup job exists
   */
  private async ensureCleanupTask(): Promise<void> {
    const cronJobsCol = await col<CronJobDoc>("cronJobs");
    const existing = (await cronJobsCol.scan({})).find(e => e.doc.name === "_hive_cleanup_runs");

    if (existing) {
      this.cleanupTaskId = existing.id;
      log.debug("[ensureCleanupTask] Cleanup job already exists");
      return;
    }

    try {
      const result = await this.create({
        name: "_hive_cleanup_runs",
        task: "Automatic cleanup of old task_runs and completed one_shot jobs",
        task_type: "recurring",
        cron_expression: "0 4 * * *",
        timezone: "UTC",
        payload: { _internal: true, action: "cleanup" },
        protect: true,
      });

      this.cleanupTaskId = result.id;
      log.info("[ensureCleanupTask] Cleanup job created");
    } catch (err) {
      log.error(`[ensureCleanupTask] Failed to create cleanup job: ${(err as Error).message}`);
    }
  }

  /**
   * Run cleanup - called by the internal cleanup job
   */
  async runCleanup(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const taskRunsCol = await col<TaskRunDoc>("taskRuns");
    const allRuns = await taskRunsCol.scan({});

    const oldRuns = allRuns.filter(e =>
      (e.doc.status === "success" || e.doc.status === "failed") && e.doc.started_at < thirtyDaysAgo
    );
    for (const run of oldRuns) {
      await taskRunsCol.delete(run.id);
    }

    const cronJobsCol = await col<CronJobDoc>("cronJobs");
    const allJobs = await cronJobsCol.scan({});
    const staleOneShots = allJobs.filter(e =>
      e.doc.task_type === "one_shot" && e.doc.status === "completed" &&
      e.doc.completed_at !== null && e.doc.completed_at < sevenDaysAgo
    );
    for (const job of staleOneShots) {
      await this.updateJob(job.id, { status: "cancelled" });
    }

    // Keep only the most recent 1000 runs per task
    const remainingRuns = allRuns.filter(r => !oldRuns.includes(r));
    const runsByTask = new Map<string, typeof remainingRuns>();
    for (const run of remainingRuns) {
      const list = runsByTask.get(run.doc.task_id) ?? [];
      list.push(run);
      runsByTask.set(run.doc.task_id, list);
    }
    for (const [, runs] of runsByTask) {
      if (runs.length <= 1000) continue;
      const toDelete = runs.sort((a, b) => b.doc.started_at.localeCompare(a.doc.started_at)).slice(1000);
      for (const run of toDelete) {
        await taskRunsCol.delete(run.id);
      }
    }

    log.info("[runCleanup] Cleanup completed");
  }

  /**
   * Get task run history
   */
  async getHistory(taskId: string, limit = 50): Promise<TaskRun[]> {
    const taskRunsCol = await col<TaskRunDoc>("taskRuns");
    const runs = (await taskRunsCol.scan({})).map(e => e.doc).filter(r => r.task_id === taskId);
    runs.sort((a, b) => b.started_at.localeCompare(a.started_at));
    return runs.slice(0, limit);
  }

  /**
   * Get a single cron job by ID
   */
  async getTask(taskId: string): Promise<CronJob | null> {
    const cronJobsCol = await col<CronJobDoc>("cronJobs");
    const entry = await cronJobsCol.get(taskId);
    return entry ? fromDoc(entry.doc) : null;
  }

  /**
   * List all cron jobs
   */
  async listTasks(status?: string): Promise<CronJob[]> {
    const cronJobsCol = await col<CronJobDoc>("cronJobs");
    const entries = status
      ? await cronJobsCol.findBy("status", status)
      : await cronJobsCol.scan({});
    const tasks = entries.map(e => fromDoc(e.doc));
    tasks.sort((a, b) => (a.next_run_at ?? "").localeCompare(b.next_run_at ?? ""));
    return tasks;
  }
}
