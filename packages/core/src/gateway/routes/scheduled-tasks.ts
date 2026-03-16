/**
 * REST API Endpoints for Scheduled Tasks
 * 
 * Endpoints for the dashboard to manage scheduled tasks.
 * These endpoints delegate to the CronScheduler instance.
 */

import type { CronScheduler } from "../../scheduler/CronScheduler";
import { getDb } from "../../storage/sqlite";

// Global scheduler instance (set during gateway initialization)
let _scheduler: CronScheduler | null = null;

export function setSchedulerInstance(scheduler: CronScheduler): void {
  _scheduler = scheduler;
}

export function getSchedulerInstance(): CronScheduler | null {
  return _scheduler;
}

/**
 * GET /api/scheduled-tasks
 * List all scheduled tasks
 */
export async function handleGetScheduledTasks(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || undefined;

  try {
    if (_scheduler) {
      const tasks = _scheduler.listTasks(status);
      return addCorsHeaders(Response.json({ tasks, count: tasks.length }), req);
    } else {
      // Fallback: direct DB query
      const db = getDb();
      let query = "SELECT * FROM scheduled_tasks WHERE 1=1";
      const args: any[] = [];

      if (status) {
        query += " AND status = ?";
        args.push(status);
      }

      query += " ORDER BY next_run_at ASC";

      const tasks = db.query(query).all(...args);
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
 * GET /api/scheduled-tasks/:id
 * Get a single scheduled task by ID
 */
export async function handleGetScheduledTask(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  taskId: string
): Promise<Response> {
  try {
    if (_scheduler) {
      const task = _scheduler.getTask(taskId);
      if (task) {
        return addCorsHeaders(Response.json({ task }), req);
      } else {
        return addCorsHeaders(
          Response.json({ error: "Task not found" }, { status: 404 }),
          req
        );
      }
    } else {
      // Fallback: direct DB query
      const db = getDb();
      const task = db.query("SELECT * FROM scheduled_tasks WHERE id = ?").get(taskId);
      if (task) {
        return addCorsHeaders(Response.json({ task }), req);
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
 * POST /api/scheduled-tasks
 * Create a new scheduled task
 */
export async function handleCreateScheduledTask(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));

    const {
      name,
      task_type,
      cron_expression,
      fire_at,
      payload,
      agent_id,
      tool_name,
      max_runs,
      channel,
      description,
      protect,
      interval_sec,
    } = body;

    if (!name || !task_type) {
      return addCorsHeaders(
        Response.json({ error: "Missing required fields: name, task_type" }, { status: 400 }),
        req
      );
    }

    // Get user timezone
    const db = getDb();
    const user = db.query("SELECT timezone FROM users LIMIT 1").get() as { timezone: string } | undefined;
    const timezone = user?.timezone || "UTC";

    if (_scheduler) {
      const result = _scheduler.create({
        name,
        description: description || "",
        task_type,
        cron_expression,
        fire_at,
        timezone,
        payload: payload || { prompt: `Execute scheduled task: ${name}` },
        agent_id: agent_id || null,
        tool_name: tool_name || null,
        max_runs: max_runs || null,
        channel: channel || "system",
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

      db.query(`
        INSERT INTO scheduled_tasks (
          id, name, description, task_type, cron_expression, fire_at, timezone,
          payload, agent_id, tool_name, max_runs, channel, protect, interval_sec,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, name, description || "", task_type, cron_expression || null, fire_at || null,
        timezone, JSON.stringify(payload || {}), agent_id || null, tool_name || null,
        max_runs || null, channel || "system", protect !== false ? 1 : 0,
        interval_sec || null, now, now
      );

      return addCorsHeaders(Response.json({
        ok: true,
        task_id: id,
      }), req);
    }
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to create task: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * PATCH /api/scheduled-tasks/:id
 * Update a scheduled task
 */
export async function handleUpdateScheduledTask(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  taskId: string
): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));

    if (_scheduler) {
      const success = _scheduler.update(taskId, body);
      if (success) {
        return addCorsHeaders(Response.json({ ok: true }), req);
      } else {
        return addCorsHeaders(
          Response.json({ error: "Task not found" }, { status: 404 }),
          req
        );
      }
    } else {
      // Fallback: direct update
      const db = getDb();
      const fields: string[] = [];
      const values: any[] = [];

      if (body.name !== undefined) {
        fields.push("name = ?");
        values.push(body.name);
      }
      if (body.description !== undefined) {
        fields.push("description = ?");
        values.push(body.description);
      }
      if (body.cron_expression !== undefined) {
        fields.push("cron_expression = ?");
        values.push(body.cron_expression);
      }
      if (body.fire_at !== undefined) {
        fields.push("fire_at = ?");
        values.push(body.fire_at);
      }
      if (body.payload !== undefined) {
        fields.push("payload = ?");
        values.push(JSON.stringify(body.payload));
      }
      if (body.status !== undefined) {
        fields.push("status = ?");
        values.push(body.status);
      }
      if (body.max_runs !== undefined) {
        fields.push("max_runs = ?");
        values.push(body.max_runs);
      }

      if (fields.length === 0) {
        return addCorsHeaders(Response.json({ ok: true }), req);
      }

      values.push(taskId);
      const result = db.query(`UPDATE scheduled_tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);

      if (result.changes > 0) {
        return addCorsHeaders(Response.json({ ok: true }), req);
      } else {
        return addCorsHeaders(
          Response.json({ error: "Task not found" }, { status: 404 }),
          req
        );
      }
    }
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to update task: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * DELETE /api/scheduled-tasks/:id
 * Delete a scheduled task
 */
export async function handleDeleteScheduledTask(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  taskId: string
): Promise<Response> {
  try {
    if (_scheduler) {
      const success = _scheduler.delete(taskId);
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
      const db = getDb();
      const result = db.query("DELETE FROM scheduled_tasks WHERE id = ?").run(taskId);

      if (result.changes > 0) {
        return addCorsHeaders(Response.json({ ok: true }), req);
      } else {
        return addCorsHeaders(
          Response.json({ error: "Task not found" }, { status: 404 }),
          req
        );
      }
    }
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to delete task: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * POST /api/scheduled-tasks/:id/pause
 * Pause a scheduled task
 */
export async function handlePauseScheduledTask(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  taskId: string
): Promise<Response> {
  try {
    if (_scheduler) {
      const success = _scheduler.pause(taskId);
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
      const db = getDb();
      const result = db.query("UPDATE scheduled_tasks SET status = 'paused' WHERE id = ?").run(taskId);

      if (result.changes > 0) {
        return addCorsHeaders(Response.json({ ok: true }), req);
      } else {
        return addCorsHeaders(
          Response.json({ error: "Task not found" }, { status: 404 }),
          req
        );
      }
    }
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to pause task: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * POST /api/scheduled-tasks/:id/resume
 * Resume a paused scheduled task
 */
export async function handleResumeScheduledTask(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  taskId: string
): Promise<Response> {
  try {
    if (_scheduler) {
      const success = _scheduler.resume(taskId);
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
      const db = getDb();
      const result = db.query("UPDATE scheduled_tasks SET status = 'active' WHERE id = ?").run(taskId);

      if (result.changes > 0) {
        return addCorsHeaders(Response.json({ ok: true }), req);
      } else {
        return addCorsHeaders(
          Response.json({ error: "Task not found" }, { status: 404 }),
          req
        );
      }
    }
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to resume task: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * POST /api/scheduled-tasks/:id/trigger
 * Manually trigger a scheduled task
 */
export async function handleTriggerScheduledTask(
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
 * GET /api/scheduled-tasks/:id/history
 * Get execution history for a scheduled task
 */
export async function handleGetTaskHistory(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  taskId: string
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "10", 10);

    const db = getDb();
    const runs = db.query(`
      SELECT * FROM task_runs 
      WHERE task_id = ? 
      ORDER BY started_at DESC 
      LIMIT ?
    `).all(taskId, limit);

    return addCorsHeaders(Response.json({ history: runs, count: runs.length }), req);
  } catch (err) {
    return addCorsHeaders(
      Response.json({ error: `Failed to get history: ${(err as Error).message}` }, { status: 500 }),
      req
    );
  }
}

/**
 * GET /api/scheduled-tasks/status
 * Get scheduler status (all tasks with their runtime status)
 */
export async function handleGetSchedulerStatus(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response
): Promise<Response> {
  try {
    if (_scheduler) {
      const status = _scheduler.getStatus();
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
