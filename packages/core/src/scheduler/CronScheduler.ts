/**
 * Hive CronScheduler
 * 
 * Croner-based scheduler for Hive with SQLite persistence.
 * Manages recurring and one-shot cron jobs that execute through the agent pipeline.
 */

import { Cron } from "croner";
import type { Database } from "bun:sqlite";
import { logger } from "../utils/logger";
import { notifyTaskCompletion } from "./integration";
import type {
  CronJob,
  TaskRun,
  CreateCronJobInput,
  UpdateCronJobInput,
  CronJobStatus,
  CronJobExecutionHandler,
} from "./types";

const log = logger.child("CronScheduler");

export class CronScheduler {
  private jobs: Map<string, Cron> = new Map();
  private db: Database;
  private handler: CronJobExecutionHandler;
  private cleanupTaskId: string | null = null;

  constructor(db: Database, handler: CronJobExecutionHandler) {
    this.db = db;
    this.handler = handler;
  }

  /**
   * Boot the scheduler - load all active jobs from DB and activate them
   */
  boot(): void {
    const tasks = this.db.query(`
      SELECT * FROM cron_jobs WHERE status = 'active'
    `).all() as CronJob[];

    for (const task of tasks) {
      this.activate(task);
    }

    log.info(`[boot] Loaded ${tasks.length} active job(s)`);

    this.ensureCleanupTask();
  }

  /**
   * Activate a cron job - create or recreate its Croner instance
   */
  activate(task: CronJob): void {
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
    if (task.error_count >= MAX_ERRORS) {
      this.db.query(
        "UPDATE cron_jobs SET status = 'paused', last_error = ?, updated_at = ? WHERE id = ?"
      ).run(`Auto-paused after ${MAX_ERRORS} consecutive errors`, new Date().toISOString(), task.id);
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
        this.db.query(
          "UPDATE cron_jobs SET next_run_at = ?, updated_at = ? WHERE id = ?"
        ).run(nextRunIso, new Date().toISOString(), task.id);
        log.info(`[activate] Job "${task.name}" (${task.id}) scheduled - next: ${nextRunIso}`);
      } else {
        log.warn(`[activate] Job "${task.name}" (${task.id}) has no next run date`);
      }
    } catch (err) {
      log.error(`[activate] Failed to activate job "${task.name}" (${task.id}): ${(err as Error).message}`);
    }
  }

  /**
   * Execute a cron job - run it through the agent pipeline
   */
  private async execute(taskId: string): Promise<void> {
    // Fix 1: read fresh task data from DB to avoid stale closure snapshots
    const task = this.db.query("SELECT * FROM cron_jobs WHERE id = ?").get(taskId) as CronJob | null;
    if (!task) {
      log.warn(`[execute] Job "${taskId}" not found in DB — skipping`);
      return;
    }

    const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const startedAt = new Date().toISOString();
    const startTime = performance.now();

    log.info(`[execute] Starting job "${task.name}" (${task.id}) run #${runId}`);

    try {
      this.db.query(`
        INSERT INTO task_runs (id, task_id, status, started_at, payload_snapshot)
        VALUES (?, ?, 'running', ?, ?)
      `).run(runId, task.id, startedAt, task.payload);
    } catch (err) {
      log.error(`[execute] Failed to create task_run record: ${(err as Error).message}`);
    }

    try {
      const result = await this.handler(task);
      const duration = performance.now() - startTime;
      const finishedAt = new Date().toISOString();

      if (result.success) {
        this.db.query(`
          UPDATE task_runs 
          SET status = 'success', finished_at = ?, duration_ms = ?, agent_response = ?
          WHERE id = ?
        `).run(finishedAt, Math.round(duration), result.response?.slice(0, 1000) || null, runId);

        this.db.query(`
          UPDATE cron_jobs 
          SET run_count = run_count + 1, last_run_at = ?, last_error = NULL
          WHERE id = ?
        `).run(finishedAt, task.id);

        const job = this.jobs.get(task.id);
        if (job) {
          const nextRun = job.nextRun();
          if (nextRun) {
            this.db.query(
              "UPDATE cron_jobs SET next_run_at = ? WHERE id = ?"
            ).run(nextRun.toISOString(), task.id);
          }
        }

        await notifyTaskCompletion(task.id, task.name, true, result.response);

        if (task.task_type === "one_shot") {
          this.db.query(`
            UPDATE cron_jobs
            SET status = 'completed', completed_at = ?
            WHERE id = ?
          `).run(finishedAt, task.id);
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

      this.db.query(`
        UPDATE task_runs 
        SET status = 'failed', finished_at = ?, duration_ms = ?, error_message = ?
        WHERE id = ?
      `).run(finishedAt, Math.round(duration), errorMessage, runId);

      this.db.query(`
        UPDATE cron_jobs
        SET error_count = error_count + 1, last_error = ?
        WHERE id = ?
      `).run(errorMessage, task.id);

      log.error(`[execute] Job "${task.name}" (${task.id}) failed: ${errorMessage}`);

      // Fix 2B: auto-pause if error threshold reached
      const MAX_ERRORS = 5;
      const updated = this.db.query(
        "SELECT error_count FROM cron_jobs WHERE id = ?"
      ).get(task.id) as { error_count: number } | null;

      if (updated && updated.error_count >= MAX_ERRORS) {
        this.db.query(
          "UPDATE cron_jobs SET status = 'paused', updated_at = ? WHERE id = ?"
        ).run(new Date().toISOString(), task.id);
        this.deactivate(task.id);
        log.warn(`[execute] Job "${task.name}" (${task.id}) auto-paused after ${MAX_ERRORS} errors`);
      }

      await notifyTaskCompletion(task.id, task.name, false, undefined, errorMessage);
    }
  }

  /**
   * Handle errors from Croner
   */
  private handleError(task: CronJob, error: Error): void {
    log.error(`[error] Job "${task.name}" (${task.id}) error: ${error.message}`);

    // Fix 3: record Croner-level errors in task_runs for full history
    const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = new Date().toISOString();
    try {
      this.db.query(`
        INSERT INTO task_runs (id, task_id, status, started_at, finished_at, duration_ms, error_message)
        VALUES (?, ?, 'failed', ?, ?, 0, ?)
      `).run(runId, task.id, now, now, error.message);
    } catch (e) {
      log.warn(`[handleError] Failed to insert task_run: ${(e as Error).message}`);
    }

    this.db.query(`
      UPDATE cron_jobs
      SET error_count = error_count + 1, last_error = ?
      WHERE id = ?
    `).run(error.message, task.id);
  }

  /**
   * Pause a cron job
   */
  pause(taskId: string): boolean {
    const job = this.jobs.get(taskId);
    if (job) {
      job.pause();
    }

    const result = this.db.query(
      "UPDATE cron_jobs SET status = 'paused' WHERE id = ?"
    ).run(taskId);

    if (result.changes > 0) {
      log.info(`[pause] Job "${taskId}" paused`);
      return true;
    }

    log.warn(`[pause] Job "${taskId}" not found`);
    return false;
  }

  /**
   * Resume a paused cron job
   */
  resume(taskId: string): boolean {
    const task = this.db.query(
      "SELECT * FROM cron_jobs WHERE id = ?"
    ).get(taskId) as CronJob | undefined;

    if (!task) {
      log.warn(`[resume] Job "${taskId}" not found`);
      return false;
    }

    this.db.query(
      "UPDATE cron_jobs SET status = 'active' WHERE id = ?"
    ).run(taskId);

    this.activate(task);
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
  delete(taskId: string): boolean {
    this.deactivate(taskId);

    const result = this.db.query(
      "DELETE FROM cron_jobs WHERE id = ?"
    ).run(taskId);

    if (result.changes > 0) {
      log.info(`[delete] Job "${taskId}" deleted`);
      return true;
    }

    log.warn(`[delete] Job "${taskId}" not found`);
    return false;
  }

  /**
   * Create a new cron job
   */
  create(input: CreateCronJobInput): { id: string; nextRun?: string } {
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

    this.db.query(`
      INSERT INTO cron_jobs (
        id, name, task, task_type, cron_expression, fire_at, timezone,
        start_at, stop_at, dom_and_dow,
        max_runs, protect, interval_sec, agent_id, channel, payload, tool_name,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      id,
      input.name,
      input.task,
      input.task_type,
      input.cron_expression || null,
      input.fire_at || null,
      input.timezone,
      input.start_at || null,
      input.stop_at || null,
      input.dom_and_dow ? 1 : 0,
      input.max_runs || null,
      input.protect !== false ? 1 : 0,
      input.interval_sec || null,
      input.agent_id || null,
      input.channel || "system",
      payloadJson,
      input.tool_name || null,
      now,
      now
    );

    const task = this.db.query(
      "SELECT * FROM cron_jobs WHERE id = ?"
    ).get(id) as CronJob;

    this.activate(task);

    const job = this.jobs.get(id);
    const nextRun = job?.nextRun()?.toISOString();

    log.info(`[create] Job "${input.name}" (${id}) created`);

    return { id, nextRun };
  }

  /**
   * Update an existing cron job
   */
  update(taskId: string, changes: UpdateCronJobInput): boolean {
    const task = this.db.query(
      "SELECT * FROM cron_jobs WHERE id = ?"
    ).get(taskId) as CronJob | undefined;

    if (!task) {
      log.warn(`[update] Job "${taskId}" not found`);
      return false;
    }

    const fields: string[] = [];
    const values: any[] = [];

    if (changes.name !== undefined) {
      fields.push("name = ?");
      values.push(changes.name);
    }
    if (changes.task !== undefined) {
      fields.push("task = ?");
      values.push(changes.task);
    }
    if (changes.task_type !== undefined) {
      fields.push("task_type = ?");
      values.push(changes.task_type);
    }
    if (changes.cron_expression !== undefined) {
      fields.push("cron_expression = ?");
      values.push(changes.cron_expression);
    }
    if (changes.fire_at !== undefined) {
      fields.push("fire_at = ?");
      values.push(changes.fire_at);
    }
    if (changes.timezone !== undefined) {
      fields.push("timezone = ?");
      values.push(changes.timezone);
    }
    if (changes.start_at !== undefined) {
      fields.push("start_at = ?");
      values.push(changes.start_at);
    }
    if (changes.stop_at !== undefined) {
      fields.push("stop_at = ?");
      values.push(changes.stop_at);
    }
    if (changes.dom_and_dow !== undefined) {
      fields.push("dom_and_dow = ?");
      values.push(changes.dom_and_dow ? 1 : 0);
    }
    if (changes.agent_id !== undefined) {
      fields.push("agent_id = ?");
      values.push(changes.agent_id);
    }
    if (changes.channel !== undefined) {
      fields.push("channel = ?");
      values.push(changes.channel);
    }
    if (changes.payload !== undefined) {
      fields.push("payload = ?");
      values.push(JSON.stringify(changes.payload));
    }
    if (changes.tool_name !== undefined) {
      fields.push("tool_name = ?");
      values.push(changes.tool_name);
    }
    if (changes.max_runs !== undefined) {
      fields.push("max_runs = ?");
      values.push(changes.max_runs);
    }
    if (changes.protect !== undefined) {
      fields.push("protect = ?");
      values.push(changes.protect ? 1 : 0);
    }
    if (changes.interval_sec !== undefined) {
      fields.push("interval_sec = ?");
      values.push(changes.interval_sec);
    }
    if (changes.status !== undefined) {
      fields.push("status = ?");
      values.push(changes.status);
    }

    if (fields.length === 0) {
      return true;
    }

    values.push(taskId);
    this.db.query(`UPDATE cron_jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values);

    const updatedTask = this.db.query(
      "SELECT * FROM cron_jobs WHERE id = ?"
    ).get(taskId) as CronJob;

    this.activate(updatedTask);

    log.info(`[update] Job "${taskId}" updated`);
    return true;
  }

  /**
   * Get status of all cron jobs
   */
  getStatus(): CronJobStatus[] {
    const tasks = this.db.query(
      "SELECT id, name, status FROM cron_jobs ORDER BY id"
    ).all() as Array<{ id: string; name: string; status: string }>;

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
    const task = this.db.query(
      "SELECT * FROM cron_jobs WHERE id = ?"
    ).get(taskId) as CronJob | undefined;

    if (!task) {
      log.warn(`[trigger] Job "${taskId}" not found`);
      return false;
    }

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
  private ensureCleanupTask(): void {
    const existing = this.db.query(
      "SELECT id FROM cron_jobs WHERE name = '_hive_cleanup_runs'"
    ).get() as { id: string } | undefined;

    if (existing) {
      this.cleanupTaskId = existing.id;
      log.debug("[ensureCleanupTask] Cleanup job already exists");
      return;
    }

    try {
      const result = this.create({
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
  runCleanup(): void {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    this.db.query(`
      DELETE FROM task_runs 
      WHERE status IN ('success', 'failed') AND started_at < ?
    `).run(thirtyDaysAgo);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    this.db.query(`
      UPDATE cron_jobs 
      SET status = 'cancelled' 
      WHERE task_type = 'one_shot' AND status = 'completed' AND completed_at < ?
    `).run(sevenDaysAgo);

    const tasks = this.db.query(`
      SELECT DISTINCT task_id FROM task_runs
    `).all() as { task_id: string }[];

    for (const { task_id } of tasks) {
      this.db.query(`
        DELETE FROM task_runs 
        WHERE task_id = ? AND id NOT IN (
          SELECT id FROM task_runs 
          WHERE task_id = ? 
          ORDER BY started_at DESC 
          LIMIT 1000
        )
      `).run(task_id, task_id);
    }

    log.info("[runCleanup] Cleanup completed");
  }

  /**
   * Get task run history
   */
  getHistory(taskId: string, limit = 50): TaskRun[] {
    return this.db.query(`
      SELECT * FROM task_runs 
      WHERE task_id = ? 
      ORDER BY started_at DESC 
      LIMIT ?
    `).all(taskId, limit) as TaskRun[];
  }

  /**
   * Get a single cron job by ID
   */
  getTask(taskId: string): CronJob | null {
    return this.db.query(
      "SELECT * FROM cron_jobs WHERE id = ?"
    ).get(taskId) as CronJob | null;
  }

  /**
   * List all cron jobs
   */
  listTasks(status?: string): CronJob[] {
    if (status) {
      return this.db.query(
        "SELECT * FROM cron_jobs WHERE status = ? ORDER BY next_run_at"
      ).all(status) as CronJob[];
    }
    return this.db.query(
      "SELECT * FROM cron_jobs ORDER BY next_run_at"
    ).all() as CronJob[];
  }
}