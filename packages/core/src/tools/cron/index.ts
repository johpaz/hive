/**
 * Cron Tools for Coordinator Agent
 *
 * Tools for managing scheduled tasks via natural language chat.
 * These tools are registered with the Coordinator agent and allow
 * users to create, list, pause, resume, delete, and trigger scheduled tasks.
 *
 * @category cron
 */

import type { Tool } from "../types";
import { getDb } from "../../storage/sqlite";
import { logger } from "../../utils/logger";
import { Cron } from "croner";

const log = logger.child("CronTools");

// Global scheduler instance (set during gateway initialization)
let _scheduler: any = null;

export function setSchedulerInstance(scheduler: any): void {
  _scheduler = scheduler;
}

export function getSchedulerInstance(): any {
  return _scheduler;
}

/**
 * Get user's timezone from database
 */
function getUserTimezone(): string {
  const db = getDb();
  const user = db.query("SELECT timezone FROM users LIMIT 1").get() as { timezone: string } | undefined;
  return user?.timezone || "UTC";
}

/**
 * Resolve the best notification channel for a user
 *
 * Priority order:
 * 1. Explicit channel if provided and has identity
 * 2. User's preferred channel from preferences
 * 3. Auto-detect by priority: telegram, discord, slack, whatsapp, webchat
 * 4. Fallback to "webchat"
 *
 * @param userId - User ID to resolve channel for
 * @param explicitChannel - Optional explicit channel preference
 * @returns Best channel string
 */
export function resolveBestChannel(userId: string, explicitChannel?: string): string {
  const db = getDb();

  // Get user's preferred channel from preferences
  const user = db.query("SELECT preferred_cron_channel FROM users WHERE id = ?", [userId]).get() as {
    preferred_cron_channel: string;
  } | undefined;

  // Get channels that have a user identity AND are currently active/connected
  const activeChannels = db.query(`
    SELECT ui.channel FROM user_identities ui
    JOIN channels c ON c.id = ui.channel
    WHERE ui.user_id = ? AND c.active = 1 AND c.status = 'connected'
  `, [userId]).all() as { channel: string }[];

  // Fallback: if no active channels found, use any identity
  const identities = activeChannels.length > 0
    ? activeChannels
    : db.query("SELECT channel FROM user_identities WHERE user_id = ?", [userId]).all() as { channel: string }[];

  // If no identities at all, return default
  if (identities.length === 0) {
    return "webchat";
  }

  // Determine best channel
  let bestChannel = "";

  // 1. Try explicit channel first
  if (explicitChannel && explicitChannel !== "system") {
    if (identities.some((i) => i.channel === explicitChannel)) {
      bestChannel = explicitChannel;
    }
  }

  // 2. Try user's preferred channel
  if (!bestChannel && user?.preferred_cron_channel && user.preferred_cron_channel !== "auto") {
    if (identities.some((i) => i.channel === user.preferred_cron_channel)) {
      bestChannel = user.preferred_cron_channel;
    }
  }

  // 3. Auto-detect by priority
  if (!bestChannel) {
    const preferred = ["telegram", "discord", "slack", "whatsapp", "webchat"];
    for (const p of preferred) {
      if (identities.some((i) => i.channel === p)) {
        bestChannel = p;
        break;
      }
    }
  }

  // 4. Fallback to first available identity
  if (!bestChannel) {
    bestChannel = identities[0].channel;
  }

  return bestChannel;
}

// ─── cron.create ─────────────────────────────────────────────────────────────

export const cronCreateTool: Tool = {
  name: "cron.create",
  description: "Create a new scheduled task. Use for recurring reminders, daily reports, automated checks. Spanish: crear tarea programada, agendar recordatorio, programar reporte",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name for the scheduled task (e.g., 'daily-report', 'morning-reminder')" },
      task_type: { type: "string", enum: ["recurring", "one_shot"], description: "Type: 'recurring' for cron-based, 'one_shot' for single execution" },
      cron_expression: { type: "string", description: "Cron expression (5-7 fields) for recurring tasks. Example: '0 9 * * *' (daily at 9 AM)" },
      fire_at: { type: "string", description: "ISO 8601 datetime for one_shot tasks. Example: '2026-04-01T09:00:00'" },
      payload: { type: "object", description: "Payload with 'prompt' or 'message' field containing the task content" },
      agent_id: { type: "string", description: "Target agent ID (optional, defaults to Coordinator)" },
      tool_name: { type: "string", description: "Specific tool to execute (optional)" },
      max_runs: { type: "number", description: "Maximum executions (optional, null = unlimited)" },
      channel: { type: "string", description: "Notification channel (system, telegram, discord, whatsapp, cli)" },
    },
    required: ["name", "task_type"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const timezone = getUserTimezone();

    const name = params.name as string | undefined;
    const task_type = params.task_type as "recurring" | "one_shot" | undefined;
    const cron_expression = params.cron_expression as string | undefined;
    const fire_at = params.fire_at as string | undefined;
    const payload = params.payload as Record<string, unknown> | undefined;
    const agent_id = params.agent_id as string | undefined;
    const tool_name = params.tool_name as string | undefined;
    const max_runs = params.max_runs as number | undefined;
    const channel = (params.channel as string) || "system";

    if (!name) {
      return { ok: false, error: "Missing required field: name" };
    }

    if (!task_type) {
      return { ok: false, error: "Missing required field: task_type (recurring or one_shot)" };
    }

    // Validate based on task type
    if (task_type === "recurring" && !cron_expression) {
      return { ok: false, error: "recurring task requires cron_expression" };
    }

    if (task_type === "one_shot" && !fire_at) {
      return { ok: false, error: "one_shot task requires fire_at" };
    }

    // Validate cron expression
    if (cron_expression) {
      try {
        new Cron(cron_expression);
      } catch (err) {
        return { ok: false, error: `Invalid cron expression: ${(err as Error).message}` };
      }
    }

    // Validate fire_at is in future
    if (fire_at) {
      const fireAtDate = new Date(fire_at);
      if (fireAtDate.getTime() <= Date.now()) {
        return { ok: false, error: "fire_at must be in the future" };
      }
    }

    // Validate payload has prompt or message
    if (payload && !payload._internal) {
      const hasPrompt = !!(payload.prompt || payload.message);
      if (!hasPrompt) {
        return { ok: false, error: "Payload must contain 'prompt' or 'message' field" };
      }
    }

    // Validate agent_id exists if provided
    if (agent_id) {
      const agent = db.query("SELECT id FROM agents WHERE id = ?").get(agent_id);
      if (!agent) {
        return { ok: false, error: `Agent not found: ${agent_id}` };
      }
    }

    try {
      // Use scheduler if available, otherwise insert directly
      if (_scheduler) {
        const result = _scheduler.create({
          name,
          task_type,
          cron_expression,
          fire_at,
          timezone,
          payload: payload || { prompt: `Execute scheduled task: ${name}` },
          agent_id: agent_id || null,
          tool_name: tool_name || null,
          max_runs: max_runs || null,
          channel,
        });

        log.info(`[create] Task "${name}" created via scheduler: ${result.id}`);

        return {
          ok: true,
          task_id: result.id,
          next_run: result.nextRun,
          message: `Task "${name}" scheduled. Next run: ${result.nextRun ? new Date(result.nextRun).toLocaleString() : "unknown"}`,
        };
      } else {
        // Fallback: direct insert (scheduler not initialized)
        const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const now = new Date().toISOString();

        db.query(`
          INSERT INTO scheduled_tasks (
            id, name, task_type, cron_expression, fire_at, timezone, payload,
            agent_id, tool_name, max_runs, channel, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, name, task_type, cron_expression || null, fire_at || null, timezone,
          JSON.stringify(payload || {}), agent_id || null, tool_name || null,
          max_runs || null, channel, now, now
        );

        return {
          ok: true,
          task_id: id,
          message: `Task "${name}" saved (scheduler not active)`,
        };
      }
    } catch (err) {
      log.error(`[create] Failed: ${(err as Error).message}`);
      return { ok: false, error: `Failed to create task: ${(err as Error).message}` };
    }
  },
};

// ─── cron.list ────────────────────────────────────────────────────────────────

export const cronListTool: Tool = {
  name: "cron.list",
  description: "List all scheduled tasks with their next execution times. Spanish: ver tareas programadas, listar cronograma",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "paused", "completed", "failed", "cancelled"], description: "Filter by status" },
      task_type: { type: "string", enum: ["recurring", "one_shot"], description: "Filter by type" },
    },
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();

    const status = params.status as string | undefined;
    const task_type = params.task_type as string | undefined;

    try {
      let query = "SELECT * FROM scheduled_tasks WHERE 1=1";
      const args: any[] = [];

      if (status) {
        query += " AND status = ?";
        args.push(status);
      }

      if (task_type) {
        query += " AND task_type = ?";
        args.push(task_type);
      }

      query += " ORDER BY next_run_at ASC";

      const tasks = db.query(query).all(...args) as any[];

      return {
        ok: true,
        tasks: tasks.map((t) => ({
          id: t.id,
          name: t.name,
          type: t.task_type,
          status: t.status,
          cron_expression: t.cron_expression,
          fire_at: t.fire_at,
          next_run: t.next_run_at,
          last_run: t.last_run_at,
          run_count: t.run_count,
          channel: t.channel,
        })),
        count: tasks.length,
      };
    } catch (err) {
      log.error(`[list] Failed: ${(err as Error).message}`);
      return { ok: false, error: `Failed to list tasks: ${(err as Error).message}` };
    }
  },
};

// ─── cron.pause ───────────────────────────────────────────────────────────────

export const cronPauseTool: Tool = {
  name: "cron.pause",
  description: "Pause a scheduled task. Spanish: pausar tarea programada, detener temporalmente",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID of the task to pause" },
    },
    required: ["task_id"],
  },
  execute: async (params: Record<string, unknown>) => {
    const task_id = params.task_id as string | undefined;

    if (!task_id) {
      return { ok: false, error: "Missing required field: task_id" };
    }

    try {
      if (_scheduler) {
        const success = _scheduler.pause(task_id);
        if (success) {
          return { ok: true, message: `Task "${task_id}" paused` };
        } else {
          return { ok: false, error: `Task "${task_id}" not found or already paused` };
        }
      } else {
        // Fallback: direct update
        const db = getDb();
        const result = db.query(
          "UPDATE scheduled_tasks SET status = 'paused' WHERE id = ?"
        ).run(task_id);

        if (result.changes > 0) {
          return { ok: true, message: `Task "${task_id}" paused (scheduler not active)` };
        } else {
          return { ok: false, error: `Task "${task_id}" not found` };
        }
      }
    } catch (err) {
      log.error(`[pause] Failed: ${(err as Error).message}`);
      return { ok: false, error: `Failed to pause task: ${(err as Error).message}` };
    }
  },
};

// ─── cron.resume ──────────────────────────────────────────────────────────────

export const cronResumeTool: Tool = {
  name: "cron.resume",
  description: "Resume a paused scheduled task. Spanish: reanudar tarea programada, continuar",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID of the task to resume" },
    },
    required: ["task_id"],
  },
  execute: async (params: Record<string, unknown>) => {
    const task_id = params.task_id as string | undefined;

    if (!task_id) {
      return { ok: false, error: "Missing required field: task_id" };
    }

    try {
      if (_scheduler) {
        const success = _scheduler.resume(task_id);
        if (success) {
          return { ok: true, message: `Task "${task_id}" resumed` };
        } else {
          return { ok: false, error: `Task "${task_id}" not found or already active` };
        }
      } else {
        // Fallback: direct update
        const db = getDb();
        const result = db.query(
          "UPDATE scheduled_tasks SET status = 'active' WHERE id = ?"
        ).run(task_id);

        if (result.changes > 0) {
          return { ok: true, message: `Task "${task_id}" resumed (scheduler not active)` };
        } else {
          return { ok: false, error: `Task "${task_id}" not found` };
        }
      }
    } catch (err) {
      log.error(`[resume] Failed: ${(err as Error).message}`);
      return { ok: false, error: `Failed to resume task: ${(err as Error).message}` };
    }
  },
};

// ─── cron.delete ──────────────────────────────────────────────────────────────

export const cronDeleteTool: Tool = {
  name: "cron.delete",
  description: "Delete a scheduled task permanently. Spanish: eliminar tarea programada, cancelar recordatorio",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID of the task to delete" },
    },
    required: ["task_id"],
  },
  execute: async (params: Record<string, unknown>) => {
    const task_id = params.task_id as string | undefined;

    if (!task_id) {
      return { ok: false, error: "Missing required field: task_id" };
    }

    try {
      if (_scheduler) {
        const success = _scheduler.delete(task_id);
        if (success) {
          return { ok: true, message: `Task "${task_id}" deleted` };
        } else {
          return { ok: false, error: `Task "${task_id}" not found` };
        }
      } else {
        // Fallback: direct delete
        const db = getDb();
        const result = db.query(
          "DELETE FROM scheduled_tasks WHERE id = ?"
        ).run(task_id);

        if (result.changes > 0) {
          return { ok: true, message: `Task "${task_id}" deleted (scheduler not active)` };
        } else {
          return { ok: false, error: `Task "${task_id}" not found` };
        }
      }
    } catch (err) {
      log.error(`[delete] Failed: ${(err as Error).message}`);
      return { ok: false, error: `Failed to delete task: ${(err as Error).message}` };
    }
  },
};

// ─── cron.trigger ─────────────────────────────────────────────────────────────

export const cronTriggerTool: Tool = {
  name: "cron.trigger",
  description: "Manually trigger a scheduled task execution immediately. Spanish: ejecutar tarea ahora, forzar ejecución",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID of the task to trigger" },
    },
    required: ["task_id"],
  },
  execute: async (params: Record<string, unknown>) => {
    const task_id = params.task_id as string | undefined;

    if (!task_id) {
      return { ok: false, error: "Missing required field: task_id" };
    }

    try {
      if (_scheduler) {
        const success = _scheduler.trigger(task_id);
        if (success) {
          return { ok: true, message: `Task "${task_id}" triggered` };
        } else {
          return { ok: false, error: `Task "${task_id}" not found or not active` };
        }
      } else {
        return { ok: false, error: "Scheduler not active - cannot trigger tasks" };
      }
    } catch (err) {
      log.error(`[trigger] Failed: ${(err as Error).message}`);
      return { ok: false, error: `Failed to trigger task: ${(err as Error).message}` };
    }
  },
};

// ─── cron.history ─────────────────────────────────────────────────────────────

export const cronHistoryTool: Tool = {
  name: "cron.history",
  description: "Get execution history for a scheduled task. Spanish: historial de ejecuciones, logs de tarea",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID of the task" },
      limit: { type: "number", description: "Maximum number of records (default: 10)" },
    },
    required: ["task_id"],
  },
  execute: async (params: Record<string, unknown>) => {
    const task_id = params.task_id as string | undefined;
    const limit = (params.limit as number) || 10;

    if (!task_id) {
      return { ok: false, error: "Missing required field: task_id" };
    }

    try {
      const db = getDb();
      const runs = db.query(`
        SELECT * FROM task_runs
        WHERE task_id = ?
        ORDER BY started_at DESC
        LIMIT ?
      `).all(task_id, limit) as any[];

      return {
        ok: true,
        history: runs.map((r) => ({
          id: r.id,
          status: r.status,
          started_at: r.started_at,
          finished_at: r.finished_at,
          duration_ms: r.duration_ms,
          error_message: r.error_message,
        })),
        count: runs.length,
      };
    } catch (err) {
      log.error(`[history] Failed: ${(err as Error).message}`);
      return { ok: false, error: `Failed to get history: ${(err as Error).message}` };
    }
  },
};

/**
 * Create all cron tools
 */
export function createTools(): Tool[] {
  return [
    cronCreateTool,
    cronListTool,
    cronPauseTool,
    cronResumeTool,
    cronDeleteTool,
    cronTriggerTool,
    cronHistoryTool,
  ];
}
