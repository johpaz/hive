/**
 * Hive CronScheduler
 * 
 * Croner-based scheduler for Hive with SQLite persistence.
 * Manages recurring and one-shot tasks that execute through the agent pipeline.
 */

import { Cron } from "croner";
import type { Database } from "bun:sqlite";
import { logger } from "../utils/logger";
import type {
  ScheduledTask,
  TaskRun,
  CreateTaskInput,
  UpdateTaskInput,
  TaskSchedulerStatus,
  TaskExecutionHandler,
  TaskExecutionResult,
} from "./types";

const log = logger.child("CronScheduler");

export class CronScheduler {
  private jobs: Map<string, Cron> = new Map();
  private db: Database;
  private handler: TaskExecutionHandler;
  private cleanupTaskId: string | null = null;

  constructor(db: Database, handler: TaskExecutionHandler) {
    this.db = db;
    this.handler = handler;
  }

  /**
   * Boot the scheduler - load all active tasks from DB and activate them
   */
  boot(): void {
    const tasks = this.db.query(`
      SELECT * FROM scheduled_tasks WHERE status = 'active'
    `).all() as ScheduledTask[];

    for (const task of tasks) {
      this.activate(task);
    }

    log.info(`[boot] Loaded ${tasks.length} active task(s)`);

    // Ensure cleanup task exists
    this.ensureCleanupTask();
  }

  /**
   * Activate a task - create or recreate its Croner instance
   */
  activate(task: ScheduledTask): void {
    // Stop existing job if any
    const existingJob = this.jobs.get(task.id);
    if (existingJob) {
      existingJob.stop();
      this.jobs.delete(task.id);
      log.debug(`[activate] Stopped existing job for task "${task.name}" (${task.id})`);
    }

    // Skip if paused or completed
    if (task.status === "paused" || task.status === "completed" || task.status === "cancelled") {
      log.debug(`[activate] Skipping task "${task.name}" (${task.id}) - status: ${task.status}`);
      return;
    }

    try {
      // Determine pattern based on task type
      let pattern: string;
      if (task.task_type === "recurring") {
        if (!task.cron_expression) {
          log.error(`[activate] Task "${task.name}" (${task.id}) is recurring but has no cron_expression`);
          return;
        }
        pattern = task.cron_expression;
      } else {
        // one_shot
        if (!task.fire_at) {
          log.error(`[activate] Task "${task.name}" (${task.id}) is one_shot but has no fire_at`);
          return;
        }
        pattern = task.fire_at;
      }

      // Validate pattern before creating Cron instance
      try {
        new Cron(pattern);
      } catch (err) {
        log.error(`[activate] Invalid cron pattern "${pattern}" for task "${task.name}": ${(err as Error).message}`);
        return;
      }

      // Build options
      const options: any = {
        timezone: task.timezone,
        protect: task.protect === 1,
        catch: (error: Error) => this.handleError(task, error),
        name: task.name,
      };

      if (task.max_runs !== null && task.max_runs !== undefined) {
        options.maxRuns = task.max_runs;
      }

      if (task.interval_sec !== null && task.interval_sec !== undefined) {
        options.interval = task.interval_sec;
      }

      // Create Cron instance
      const cron = new Cron(
        pattern,
        options,
        () => this.execute(task)
      );

      this.jobs.set(task.id, cron);

      // Calculate and persist next_run_at
      const nextRun = cron.nextRun();
      if (nextRun) {
        const nextRunIso = nextRun.toISOString();
        this.db.query(
          "UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?"
        ).run(nextRunIso, task.id);
        log.info(`[activate] Task "${task.name}" (${task.id}) scheduled - next: ${nextRunIso}`);
      } else {
        log.warn(`[activate] Task "${task.name}" (${task.id}) has no next run date`);
      }
    } catch (err) {
      log.error(`[activate] Failed to activate task "${task.name}" (${task.id}): ${(err as Error).message}`);
    }
  }

  /**
   * Execute a task - run it through the agent pipeline
   */
  private async execute(task: ScheduledTask): Promise<void> {
    const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const startedAt = new Date().toISOString();
    const startTime = performance.now();

    log.info(`[execute] Starting task "${task.name}" (${task.id}) run #${runId}`);

    // Create run record
    try {
      this.db.query(`
        INSERT INTO task_runs (id, task_id, status, started_at, payload_snapshot)
        VALUES (?, ?, 'running', ?, ?)
      `).run(runId, task.id, startedAt, task.payload);
    } catch (err) {
      log.error(`[execute] Failed to create task_run record: ${(err as Error).message}`);
    }

    try {
      // Execute via handler
      const result = await this.handler(task);
      const duration = performance.now() - startTime;
      const finishedAt = new Date().toISOString();

      if (result.success) {
        // Success
        this.db.query(`
          UPDATE task_runs 
          SET status = 'success', finished_at = ?, duration_ms = ?, agent_response = ?
          WHERE id = ?
        `).run(finishedAt, Math.round(duration), result.response?.slice(0, 1000) || null, runId);

        // Update task stats
        this.db.query(`
          UPDATE scheduled_tasks 
          SET run_count = run_count + 1, last_run_at = ?, last_error = NULL
          WHERE id = ?
        `).run(finishedAt, task.id);

        // Recalculate next_run_at
        const job = this.jobs.get(task.id);
        if (job) {
          const nextRun = job.nextRun();
          if (nextRun) {
            this.db.query(
              "UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?"
            ).run(nextRun.toISOString(), task.id);
          }
        }

        // Handle one_shot completion
        if (task.task_type === "one_shot") {
          this.db.query(`
            UPDATE scheduled_tasks 
            SET status = 'completed', completed_at = ?
            WHERE id = ?
          `).run(finishedAt, task.id);
          this.deactivate(task.id);
          log.info(`[execute] One-shot task "${task.name}" (${task.id}) completed`);
        } else {
          log.info(`[execute] Task "${task.name}" (${task.id}) completed in ${Math.round(duration)}ms`);
        }
      } else {
        // Handler reported failure
        throw new Error(result.error || "Handler reported failure");
      }
    } catch (err) {
      const duration = performance.now() - startTime;
      const finishedAt = new Date().toISOString();
      const errorMessage = (err as Error).message;

      // Update task_run record
      this.db.query(`
        UPDATE task_runs 
        SET status = 'failed', finished_at = ?, duration_ms = ?, error_message = ?
        WHERE id = ?
      `).run(finishedAt, Math.round(duration), errorMessage, runId);

      // Update task stats
      this.db.query(`
        UPDATE scheduled_tasks 
        SET error_count = error_count + 1, last_error = ?
        WHERE id = ?
      `).run(errorMessage, task.id);

      log.error(`[execute] Task "${task.name}" (${task.id}) failed: ${errorMessage}`);
    }
  }

  /**
   * Handle errors from Croner
   */
  private handleError(task: ScheduledTask, error: Error): void {
    log.error(`[error] Task "${task.name}" (${task.id}) error: ${error.message}`);
    
    this.db.query(`
      UPDATE scheduled_tasks 
      SET error_count = error_count + 1, last_error = ?
      WHERE id = ?
    `).run(error.message, task.id);
  }

  /**
   * Pause a task
   */
  pause(taskId: string): boolean {
    const job = this.jobs.get(taskId);
    if (job) {
      job.pause();
    }

    const result = this.db.query(
      "UPDATE scheduled_tasks SET status = 'paused' WHERE id = ?"
    ).run(taskId);

    if (result.changes > 0) {
      log.info(`[pause] Task "${taskId}" paused`);
      return true;
    }

    log.warn(`[pause] Task "${taskId}" not found`);
    return false;
  }

  /**
   * Resume a paused task
   */
  resume(taskId: string): boolean {
    const task = this.db.query(
      "SELECT * FROM scheduled_tasks WHERE id = ?"
    ).get(taskId) as ScheduledTask | undefined;

    if (!task) {
      log.warn(`[resume] Task "${taskId}" not found`);
      return false;
    }

    this.db.query(
      "UPDATE scheduled_tasks SET status = 'active' WHERE id = ?"
    ).run(taskId);

    this.activate(task);
    log.info(`[resume] Task "${taskId}" resumed`);
    return true;
  }

  /**
   * Deactivate a task - stop Croner instance but keep in DB
   */
  deactivate(taskId: string): void {
    const job = this.jobs.get(taskId);
    if (job) {
      job.stop();
      this.jobs.delete(taskId);
      log.debug(`[deactivate] Task "${taskId}" deactivated`);
    }
  }

  /**
   * Delete a task - deactivate and remove from DB
   */
  delete(taskId: string): boolean {
    this.deactivate(taskId);

    const result = this.db.query(
      "DELETE FROM scheduled_tasks WHERE id = ?"
    ).run(taskId);

    if (result.changes > 0) {
      log.info(`[delete] Task "${taskId}" deleted`);
      return true;
    }

    log.warn(`[delete] Task "${taskId}" not found`);
    return false;
  }

  /**
   * Create a new scheduled task
   */
  create(input: CreateTaskInput): { id: string; nextRun?: string } {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = new Date().toISOString();

    // Validate cron expression if recurring
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

    // Validate fire_at if one_shot
    if (input.task_type === "one_shot") {
      if (!input.fire_at) {
        throw new Error("one_shot task requires fire_at");
      }
      const fireAt = new Date(input.fire_at);
      if (fireAt.getTime() <= Date.now()) {
        throw new Error("fire_at must be in the future");
      }
    }

    // Validate timezone
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: input.timezone });
    } catch (err) {
      throw new Error(`Invalid timezone: ${input.timezone}`);
    }

    // Validate payload is valid JSON
    const payloadJson = input.payload ? JSON.stringify(input.payload) : "{}";
    try {
      JSON.parse(payloadJson);
    } catch (err) {
      throw new Error("Invalid payload JSON");
    }

    // Insert task
    this.db.query(`
      INSERT INTO scheduled_tasks (
        id, name, description, task_type, cron_expression, fire_at, timezone,
        max_runs, protect, interval_sec, agent_id, channel, payload, tool_name,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      id,
      input.name,
      input.description || "",
      input.task_type,
      input.cron_expression || null,
      input.fire_at || null,
      input.timezone,
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

    // Read back and activate
    const task = this.db.query(
      "SELECT * FROM scheduled_tasks WHERE id = ?"
    ).get(id) as ScheduledTask;

    this.activate(task);

    // Get next run
    const job = this.jobs.get(id);
    const nextRun = job?.nextRun()?.toISOString();

    log.info(`[create] Task "${input.name}" (${id}) created`);

    return { id, nextRun };
  }

  /**
   * Update an existing task
   */
  update(taskId: string, changes: UpdateTaskInput): boolean {
    const task = this.db.query(
      "SELECT * FROM scheduled_tasks WHERE id = ?"
    ).get(taskId) as ScheduledTask | undefined;

    if (!task) {
      log.warn(`[update] Task "${taskId}" not found`);
      return false;
    }

    const fields: string[] = [];
    const values: any[] = [];

    if (changes.name !== undefined) {
      fields.push("name = ?");
      values.push(changes.name);
    }
    if (changes.description !== undefined) {
      fields.push("description = ?");
      values.push(changes.description);
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
      return true; // No changes
    }

    values.push(taskId);
    this.db.query(`UPDATE scheduled_tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);

    // Reload and reactivate
    const updatedTask = this.db.query(
      "SELECT * FROM scheduled_tasks WHERE id = ?"
    ).get(taskId) as ScheduledTask;

    this.activate(updatedTask);

    log.info(`[update] Task "${taskId}" updated`);
    return true;
  }

  /**
   * Get status of all scheduled tasks
   */
  getStatus(): TaskSchedulerStatus[] {
    const tasks = this.db.query(
      "SELECT id, name, status FROM scheduled_tasks ORDER BY id"
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
   * Manually trigger a task execution
   */
  trigger(taskId: string): boolean {
    const task = this.db.query(
      "SELECT * FROM scheduled_tasks WHERE id = ?"
    ).get(taskId) as ScheduledTask | undefined;

    if (!task) {
      log.warn(`[trigger] Task "${taskId}" not found`);
      return false;
    }

    const job = this.jobs.get(taskId);
    if (!job) {
      log.warn(`[trigger] Task "${taskId}" has no active job`);
      return false;
    }

    // Trigger immediate execution
    job.trigger();
    log.info(`[trigger] Task "${taskId}" manually triggered`);
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
   * Ensure the cleanup task exists
   */
  private ensureCleanupTask(): void {
    const existing = this.db.query(
      "SELECT id FROM scheduled_tasks WHERE name = '_hive_cleanup_runs'"
    ).get() as { id: string } | undefined;

    if (existing) {
      this.cleanupTaskId = existing.id;
      log.debug("[ensureCleanupTask] Cleanup task already exists");
      return;
    }

    try {
      const result = this.create({
        name: "_hive_cleanup_runs",
        description: "Automatic cleanup of old task_runs and completed one_shot tasks",
        task_type: "recurring",
        cron_expression: "0 4 * * *", // 4 AM UTC daily
        timezone: "UTC",
        payload: { _internal: true, action: "cleanup" },
        protect: true,
      });

      this.cleanupTaskId = result.id;
      log.info("[ensureCleanupTask] Cleanup task created");
    } catch (err) {
      log.error(`[ensureCleanupTask] Failed to create cleanup task: ${(err as Error).message}`);
    }
  }

  /**
   * Run cleanup - called by the internal cleanup task
   */
  runCleanup(): void {
    const now = new Date().toISOString();

    // Delete task_runs older than 30 days with status success or failed
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    this.db.query(`
      DELETE FROM task_runs 
      WHERE status IN ('success', 'failed') AND started_at < ?
    `).run(thirtyDaysAgo);

    // Mark old completed one_shot tasks as cancelled (older than 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    this.db.query(`
      UPDATE scheduled_tasks 
      SET status = 'cancelled' 
      WHERE task_type = 'one_shot' AND status = 'completed' AND completed_at < ?
    `).run(sevenDaysAgo);

    // Limit task_runs to 1000 per task
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
   * Get a single task by ID
   */
  getTask(taskId: string): ScheduledTask | null {
    return this.db.query(
      "SELECT * FROM scheduled_tasks WHERE id = ?"
    ).get(taskId) as ScheduledTask | null;
  }

  /**
   * List all tasks
   */
  listTasks(status?: string): ScheduledTask[] {
    if (status) {
      return this.db.query(
        "SELECT * FROM scheduled_tasks WHERE status = ? ORDER BY next_run_at"
      ).all(status) as ScheduledTask[];
    }
    return this.db.query(
      "SELECT * FROM scheduled_tasks ORDER BY next_run_at"
    ).all() as ScheduledTask[];
  }
}
