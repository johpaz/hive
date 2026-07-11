/**
 * TaskDriver — event-driven project/task execution engine.
 *
 * Source of truth: HiveDB (tasks collection) + durable queue (jobQueue).
 * NOT an in-memory DAGScheduler — the driver just picks up tasks whose
 * dependencies are met and enqueues project_task jobs.
 *
 * Two triggers:
 * 1. Event-driven: kick() called when a job completes (from job-executors)
 * 2. Polling backup: every 10s, scan for ready tasks (handles edge cases
 *    where events are missed)
 *
 * On each kick/poll:
 * - Find tasks with status=pending
 * - For each: check all deps are completed → claim OCC → enqueue project_task
 * - If a dep failed → mark dependents as blocked
 * - When all tasks done → update project status to "done" or "failed"
 */

import { col, updateDoc } from "../storage/hive";
import type { TaskDoc, ProjectDoc } from "../storage/collections";
import { logger } from "../utils/logger";
import { getDurableQueue } from "../gateway/durable-queue";
import { createRun } from "../agent/run-store";
import { resolveAgentId } from "../storage/onboarding";

const log = logger.child("task-driver");

const POLL_INTERVAL_MS = 10_000;

export class TaskDriver {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.kick("poll").catch((err) => {
        log.error(`[poll] Error: ${(err as Error).message}`);
      });
    }, POLL_INTERVAL_MS);
    log.info(`[start] TaskDriver polling every ${POLL_INTERVAL_MS}ms`);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Scan for ready tasks and enqueue them. Called after a job completes
   * (event-driven) or by the polling timer (backup).
   */
  async kick(reason: string = "event"): Promise<number> {
    if (this.running) return 0;
    this.running = true;

    try {
      const tasksCol = await col<TaskDoc>("tasks");
      const pending = (await tasksCol.scan({})).filter((e) => e.doc.status === "pending");
      let enqueued = 0;

      for (const entry of pending) {
        const task = entry.doc;

        // Check dependencies
        if (task.depends_on) {
          const deps: string[] = JSON.parse(task.depends_on);
          const depResults = await Promise.all(deps.map(async (depId) => {
            const dep = await tasksCol.get(depId);
            return dep ? dep.doc.status : "missing";
          }));

          // If any dep failed → mark this task as blocked
          if (depResults.some((s) => s === "failed" || s === "missing")) {
            await updateDoc<TaskDoc>("tasks", task.id, {
              status: "blocked",
              error: "A dependency failed or is missing",
              updated_at: Date.now(),
            } as Partial<TaskDoc>).catch(() => {});
            continue;
          }

          // If any dep is not completed → skip
          if (depResults.some((s) => s !== "completed")) {
            continue;
          }
        }

        // All deps completed (or no deps) → enqueue project_task
        const workerId = task.agent_id && task.agent_id !== "__none__"
          ? task.agent_id
          : (await resolveAgentId(null)) || "main";

        const run = await createRun({
          thread_id: `project-${task.project_id}-${task.id}`,
          agent_id: workerId,
          user_id: "",
          channel: null,
          kind: "project",
          max_iterations: 20,
          resume_policy: "resume",
        });

        const queue = getDurableQueue();
        await queue.enqueue({
          lane: `task:${task.id}`,
          type: "project_task",
          run_id: run.id,
          payload: {
            taskId: task.id,
            workerId,
            taskDescription: task.description ?? task.name,
          },
          priority: task.priority,
        });

        enqueued++;
        log.info(`[kick:${reason}] Enqueued project_task for task ${task.id} (${task.name})`);
      }

      // Check if any projects are fully done
      await this.updateProjectStatuses();

      return enqueued;
    } finally {
      this.running = false;
    }
  }

  /**
   * For each active project: if all tasks are completed → mark project as done.
   * If any task failed and no other tasks can proceed → mark project as failed.
   */
  private async updateProjectStatuses(): Promise<void> {
    try {
      const projectsCol = await col<ProjectDoc>("projects");
      const activeProjects = (await projectsCol.findBy("status", "active")).filter(
        (e) => e.doc.status === "active"
      );

      const tasksCol = await col<TaskDoc>("tasks");

      for (const projectEntry of activeProjects) {
        const project = projectEntry.doc;
        const taskEntries = await tasksCol.findBy("project_id", project.id);
        const tasks = taskEntries.map((e) => e.doc);

        if (tasks.length === 0) continue;

        const allCompleted = tasks.every((t) => t.status === "completed");
        const anyFailed = tasks.some((t) => t.status === "failed" || t.status === "blocked");
        const anyPending = tasks.some((t) => t.status === "pending" || t.status === "in_progress");

        if (allCompleted) {
          await updateDoc<ProjectDoc>("projects", project.id, {
            status: "done",
            progress: 100,
            completed_at: Date.now(),
            updated_at: Date.now(),
          } as Partial<ProjectDoc>).catch(() => {});
          log.info(`[updateProjectStatuses] Project ${project.id} (${project.name}) → done`);
        } else if (anyFailed && !anyPending) {
          await updateDoc<ProjectDoc>("projects", project.id, {
            status: "failed",
            updated_at: Date.now(),
          } as Partial<ProjectDoc>).catch(() => {});
          log.warn(`[updateProjectStatuses] Project ${project.id} (${project.name}) → failed`);
        }
      }
    } catch (err) {
      log.warn(`[updateProjectStatuses] Error: ${(err as Error).message}`);
    }
  }
}

// Singleton
let _taskDriver: TaskDriver | null = null;

export function getTaskDriver(): TaskDriver {
  if (!_taskDriver) {
    _taskDriver = new TaskDriver();
  }
  return _taskDriver;
}

export function initTaskDriver(): TaskDriver {
  _taskDriver = new TaskDriver();
  _taskDriver.start();
  return _taskDriver;
}