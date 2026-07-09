/**
 * REST API Endpoints for Cron Jobs
 *
 * Endpoints for the dashboard to manage cron jobs.
 * These endpoints delegate to the CronScheduler instance.
 */

import type { CronScheduler } from "../../scheduler/CronScheduler";
import { col, toIndexable } from "../../storage/hive";
import type { CronJobDoc, TaskRunDoc, UserDoc, UserIdentityDoc, ChannelDoc } from "../../storage/collections";

// Global scheduler instance (set during gateway initialization)
let _scheduler: CronScheduler | null = null;

export function setSchedulerInstance(scheduler: CronScheduler): void {
  _scheduler = scheduler;
}

export function getSchedulerInstance(): CronScheduler | null {
  return _scheduler;
}

/**
 * GET /api/cron
 * List all scheduled tasks
 */
export async function handleGetCronJobs(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || undefined;

  try {
    if (_scheduler) {
      const tasks = await _scheduler.listTasks(status);
      return addCorsHeaders(Response.json({ tasks, count: tasks.length }), req);
    } else {
      // Fallback: direct collection scan
      const cronJobsCol = await col<CronJobDoc>("cronJobs");
      let tasks = (await cronJobsCol.scan({})).map(e => e.doc);
      if (status) tasks = tasks.filter(t => t.status === status);
      tasks.sort((a, b) => (a.next_run_at ?? "").localeCompare(b.next_run_at ?? ""));
      return addCorsHeaders(Response.json({ tasks, count: tasks.length }), req);
    }
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to list tasks: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * GET /api/cron/:id
 * Get a single scheduled task by ID
 */
export async function handleGetCronJob(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  taskId: string
): Promise<Response> {
  try {
    if (_scheduler) {
      const task = await _scheduler.getTask(taskId);
      if (task) {
        return addCorsHeaders(Response.json({ task }), req);
      } else {
        return addCorsHeaders(
          Response.json({ error: "Task not found" }, { status: 404 }),
          req
        );
      }
    } else {
      // Fallback: direct collection lookup
      const cronJobsCol = await col<CronJobDoc>("cronJobs");
      const entry = await cronJobsCol.get(taskId);
      if (entry) {
        return addCorsHeaders(Response.json({ task: entry.doc }), req);
      } else {
        return addCorsHeaders(
          Response.json({ error: "Task not found" }, { status: 404 }),
          req
        );
      }
    }
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to get task: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * POST /api/cron
 * Create a new cron job
 */
export async function handleCreateCronJob(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));

    const {
      name,
      task,
      task_type,
      cron_expression,
      fire_at,
      payload,
      agent_id,
      tool_name,
      max_runs,
      channel,
      start_at,
      stop_at,
      dom_and_dow,
      protect,
      interval_sec,
    } = body;

    if (!name || !task_type || !task) {
      return addCorsHeaders(
        Response.json({ error: "Missing required fields: name, task, task_type" }, { status: 400 }),
        req
      );
    }

    // Get user timezone
    const usersCol = await col<UserDoc>("users");
    const userEntry = (await usersCol.scan({ limit: 1 }))[0];
    const timezone = userEntry?.doc.timezone || "UTC";

    if (_scheduler) {
      const result = await _scheduler.create({
        name,
        task,
        task_type,
        cron_expression,
        fire_at,
        timezone,
        payload: payload || { prompt: task },
        agent_id: agent_id || null,
        tool_name: tool_name || null,
        max_runs: max_runs || null,
        channel: channel || "system",
        start_at: start_at || undefined,
        stop_at: stop_at || undefined,
        dom_and_dow: dom_and_dow || false,
        protect: protect !== false,
        interval_sec: interval_sec || null,
      });

      return addCorsHeaders(Response.json({
        ok: true,
        task_id: result.id,
        next_run: result.nextRun,
      }), req);
    } else {
      // Fallback: direct insert
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const now = new Date().toISOString();

      const cronJobsCol = await col<CronJobDoc>("cronJobs");
      await cronJobsCol.put(id, {
        id, name, task, task_type,
        cron_expression: cron_expression || null,
        fire_at: fire_at || null,
        timezone,
        start_at: start_at || null,
        stop_at: stop_at || null,
        dom_and_dow: dom_and_dow ? 1 : 0,
        payload: JSON.stringify(payload || {}),
        agent_id: toIndexable(agent_id || null),
        tool_name: tool_name || null,
        max_runs: max_runs || null,
        channel: channel || "system",
        protect: protect !== false ? 1 : 0,
        interval_sec: interval_sec || null,
        status: "active",
        run_count: 0,
        error_count: 0,
        last_error: null,
        created_at: now,
        updated_at: now,
        last_run_at: null,
        next_run_at: null,
        completed_at: null,
      }, { expectedVersion: 0 });

      return addCorsHeaders(Response.json({
        ok: true,
        task_id: id,
      }), req);
    }
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to create job: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * PATCH /api/cron/:id
 * Update a cron job
 */
export async function handleUpdateCronJob(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  taskId: string
): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));

    if (_scheduler) {
      const success = await _scheduler.update(taskId, body);
      if (success) {
        return addCorsHeaders(Response.json({ ok: true }), req);
      } else {
        return addCorsHeaders(
          Response.json({ error: "Job not found" }, { status: 404 }),
          req
        );
      }
    } else {
      // Fallback: direct update
      const cronJobsCol = await col<CronJobDoc>("cronJobs");
      const existing = await cronJobsCol.get(taskId);
      if (!existing) {
        return addCorsHeaders(
          Response.json({ error: "Task not found" }, { status: 404 }),
          req
        );
      }

      const patch: Partial<CronJobDoc> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.task !== undefined) patch.task = body.task;
      if (body.cron_expression !== undefined) patch.cron_expression = body.cron_expression;
      if (body.fire_at !== undefined) patch.fire_at = body.fire_at;
      if (body.start_at !== undefined) patch.start_at = body.start_at;
      if (body.stop_at !== undefined) patch.stop_at = body.stop_at;
      if (body.dom_and_dow !== undefined) patch.dom_and_dow = body.dom_and_dow ? 1 : 0;
      if (body.payload !== undefined) patch.payload = JSON.stringify(body.payload);
      if (body.status !== undefined) patch.status = body.status;
      if (body.max_runs !== undefined) patch.max_runs = body.max_runs;

      if (Object.keys(patch).length === 0) {
        return addCorsHeaders(Response.json({ ok: true }), req);
      }

      await cronJobsCol.put(taskId, { ...existing.doc, ...patch }, { expectedVersion: existing.version });

      return addCorsHeaders(Response.json({ ok: true }), req);
    }
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to update task: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * DELETE /api/cron/:id
 * Delete a scheduled task
 */
export async function handleDeleteCronJob(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  taskId: string
): Promise<Response> {
  try {
    if (_scheduler) {
      const success = await _scheduler.delete(taskId);
      if (success) {
        return addCorsHeaders(Response.json({ ok: true }), req);
      } else {
        return addCorsHeaders(
          Response.json({ error: "Task not found" }, { status: 404 }),
          req
        );
      }
    } else {
      // Fallback: direct delete
      const cronJobsCol = await col<CronJobDoc>("cronJobs");
      const existing = await cronJobsCol.get(taskId);
      if (!existing) {
        return addCorsHeaders(
          Response.json({ error: "Task not found" }, { status: 404 }),
          req
        );
      }
      await cronJobsCol.delete(taskId);
      return addCorsHeaders(Response.json({ ok: true }), req);
    }
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to delete task: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * POST /api/cron/:id/pause
 * Pause a scheduled task
 */
export async function handlePauseCronJob(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  taskId: string
): Promise<Response> {
  try {
    if (_scheduler) {
      const success = await _scheduler.pause(taskId);
      if (success) {
        return addCorsHeaders(Response.json({ ok: true, message: `Task "${taskId}" paused` }), req);
      } else {
        return addCorsHeaders(
          Response.json({ error: "Task not found or already paused" }, { status: 404 }),
          req
        );
      }
    } else {
      // Fallback: direct update
      const cronJobsCol = await col<CronJobDoc>("cronJobs");
      const existing = await cronJobsCol.get(taskId);
      if (!existing) {
        return addCorsHeaders(
          Response.json({ error: "Task not found" }, { status: 404 }),
          req
        );
      }
      await cronJobsCol.put(taskId, { ...existing.doc, status: "paused" }, { expectedVersion: existing.version });
      return addCorsHeaders(Response.json({ ok: true }), req);
    }
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to pause task: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * POST /api/cron/:id/resume
 * Resume a paused scheduled task
 */
export async function handleResumeCronJob(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  taskId: string
): Promise<Response> {
  try {
    if (_scheduler) {
      const success = await _scheduler.resume(taskId);
      if (success) {
        return addCorsHeaders(Response.json({ ok: true, message: `Task "${taskId}" resumed` }), req);
      } else {
        return addCorsHeaders(
          Response.json({ error: "Task not found or already active" }, { status: 404 }),
          req
        );
      }
    } else {
      // Fallback: direct update
      const cronJobsCol = await col<CronJobDoc>("cronJobs");
      const existing = await cronJobsCol.get(taskId);
      if (!existing) {
        return addCorsHeaders(
          Response.json({ error: "Task not found" }, { status: 404 }),
          req
        );
      }
      await cronJobsCol.put(taskId, { ...existing.doc, status: "active" }, { expectedVersion: existing.version });
      return addCorsHeaders(Response.json({ ok: true }), req);
    }
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to resume task: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * POST /api/cron/:id/trigger
 * Manually trigger a scheduled task
 */
export async function handleTriggerCronJob(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  taskId: string
): Promise<Response> {
  try {
    if (_scheduler) {
      const success = _scheduler.trigger(taskId);
      if (success) {
        return addCorsHeaders(Response.json({ ok: true, message: `Task "${taskId}" triggered` }), req);
      } else {
        return addCorsHeaders(
          Response.json({ error: "Task not found or not active" }, { status: 404 }),
          req
        );
      }
    } else {
      return addCorsHeaders(
        Response.json({ error: "Scheduler not active" }, { status: 503 }),
        req
      );
    }
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to trigger task: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * GET /api/cron/:id/history
 * Get execution history for a scheduled task
 */
export async function handleGetCronJobHistory(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  taskId: string
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "10", 10);

    const taskRunsCol = await col<TaskRunDoc>("taskRuns");
    const runs = (await taskRunsCol.scan({}))
      .map(e => e.doc)
      .filter(r => r.task_id === taskId)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, limit);

    return addCorsHeaders(Response.json({ history: runs, count: runs.length }), req);
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to get history: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * GET /api/cron/status
 * Get scheduler status (all tasks with their runtime status)
 */
export async function handleGetCronStatus(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  try {
    if (_scheduler) {
      const status = await _scheduler.getStatus();
      return addCorsHeaders(Response.json({ status }), req);
    } else {
      return addCorsHeaders(Response.json({ status: [], message: "Scheduler not active" }), req);
    }
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to get status: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * GET /api/cron/channels
 * Get available notification channels for cron jobs
 */
export async function handleGetCronChannels(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  try {
    const usersCol = await col<UserDoc>("users");
    const userEntry = (await usersCol.scan({ limit: 1 }))[0];
    const userId = userEntry?.id || "";

    const identitiesCol = await col<UserIdentityDoc>("userIdentities");
    const identityEntries = await identitiesCol.scan({ prefix: `${userId}:` });
    const identityChannels = [...new Set(identityEntries.map(e => e.doc.channel))];

    const channelsCol = await col<ChannelDoc>("channels");
    const channels: Array<{ id: string; type: string; active: boolean; status: string }> = [];
    for (const type of identityChannels) {
      const entry = await channelsCol.get(type);
      if (entry?.doc.active) {
        channels.push({ id: entry.id, type: entry.doc.type, active: entry.doc.active, status: entry.doc.status });
      }
    }

    const recommended = ["telegram", "discord", "slack", "whatsapp", "webchat"];
    const formatted = channels.map(ch => ({
      id: ch.id,
      type: ch.type || ch.id,
      active: ch.active,
      recommended: recommended.includes(ch.type || ch.id),
    }));

    if (formatted.length === 0) {
      formatted.push({ id: "webchat", type: "webchat", active: true, recommended: true });
    }

    return addCorsHeaders(Response.json({ channels: formatted }), req);
  } catch (err) {
    // Non-critical — return empty channels
    return addCorsHeaders(Response.json({ channels: [{ id: "webchat", type: "webchat", active: true, recommended: true }] }), req);
  }
}
