/**
 * Cron Tools for Coordinator Agent
 *
 * Tools for managing cron jobs via natural language chat.
 * These tools are registered with the Coordinator agent and allow
 * users to create, list, update, pause, resume, delete, and trigger cron jobs.
 *
 * @category cron
 */

import type { Tool } from "../types";
import { getDb } from "../../storage/sqlite";
import { logger } from "../../utils/logger";
import { Cron } from "croner";

const log = logger.child("CronTools");

let _scheduler: any = null;

export function setSchedulerInstance(scheduler: any): void {
  _scheduler = scheduler;
}

export function getSchedulerInstance(): any {
  return _scheduler;
}

function getUserTimezone(): string {
  const db = getDb();
  const user = db.query("SELECT timezone FROM users LIMIT 1").get() as { timezone: string } | undefined;
  return user?.timezone || "UTC";
}

export function resolveBestChannel(userId: string, explicitChannel?: string): string {
  const db = getDb();

  const user = db.query("SELECT preferred_cron_channel FROM users WHERE id = ? LIMIT 1").get(userId) as {
    preferred_cron_channel: string;
  } | undefined;

  const activeChannels = db.query(`
    SELECT DISTINCT ui.channel FROM user_identities ui
    JOIN channels c ON c.type = ui.channel
    WHERE ui.user_id = ? AND c.active = 1 AND c.status = 'connected'
  `).all(userId) as { channel: string }[];

  log.debug(`[resolveBestChannel] userId=${userId}, explicit=${explicitChannel}, preferred=${user?.preferred_cron_channel}, activeChannels=[${activeChannels.map(c => c.channel).join(", ")}]`);

  const identities = activeChannels.length > 0
    ? activeChannels
    : db.query("SELECT channel FROM user_identities WHERE user_id = ?").all(userId) as { channel: string }[];

  if (identities.length === 0) {
    log.warn(`[resolveBestChannel] No identities found for user ${userId}, falling back to webchat`);
    return "webchat";
  }

  let bestChannel = "";

  if (explicitChannel && explicitChannel !== "system") {
    if (identities.some((i) => i.channel === explicitChannel)) {
      bestChannel = explicitChannel;
      log.info(`[resolveBestChannel] Using explicit channel: ${bestChannel}`);
    }
  }

  if (!bestChannel && user?.preferred_cron_channel && user.preferred_cron_channel !== "auto") {
    if (identities.some((i) => i.channel === user.preferred_cron_channel)) {
      bestChannel = user.preferred_cron_channel;
      log.info(`[resolveBestChannel] Using preferred_cron_channel: ${bestChannel}`);
    } else {
      log.warn(`[resolveBestChannel] preferred_cron_channel=${user.preferred_cron_channel} not in identities=[${identities.map(i => i.channel).join(", ")}]`);
    }
  }

  if (!bestChannel) {
    const preferred = ["telegram", "discord", "slack", "whatsapp", "webchat"];
    for (const p of preferred) {
      if (identities.some((i) => i.channel === p)) {
        bestChannel = p;
        log.info(`[resolveBestChannel] Using fallback priority: ${bestChannel}`);
        break;
      }
    }
  }

  if (!bestChannel) {
    bestChannel = identities[0].channel;
    log.info(`[resolveBestChannel] Using first identity: ${bestChannel}`);
  }

  return bestChannel;
}

// ─── cron.create ─────────────────────────────────────────────────────────────

export const cronCreateTool: Tool = {
  name: "cron.create",
  description: "Create a new cron job. Use for recurring reminders, daily reports, automated checks. Spanish: crear tarea programada, agendar recordatorio, programar reporte",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short name for the job (e.g., 'daily-report', 'morning-reminder')" },
      task: { type: "string", description: "REQUIRED: Natural language instruction the agent reads when the job triggers (e.g., 'Generate daily sales report and send summary via Telegram')" },
      task_type: { type: "string", enum: ["recurring", "one_shot"], description: "Type: 'recurring' for cron-based, 'one_shot' for single execution" },
      cron_expression: { type: "string", description: "Cron expression (5-7 fields) for recurring tasks. Example: '0 9 * * *' (daily at 9 AM)" },
      fire_at: { type: "string", description: "ISO 8601 datetime for one_shot tasks. Example: '2026-04-01T09:00:00'" },
      payload: { type: "object", description: "Payload with 'prompt' or 'message' field. Defaults to using 'task' field if omitted" },
      agent_id: { type: "string", description: "Target agent ID (optional, defaults to Coordinator)" },
      tool_name: { type: "string", description: "Specific tool to execute (optional)" },
      max_runs: { type: "number", description: "Maximum executions (optional, null = unlimited)" },
      channel: { type: "string", description: "Notification channel (system, telegram, discord, whatsapp, cli)" },
      start_at: { type: "string", description: "ISO 8601 datetime: start of execution window (Croner startAt). Optional." },
      stop_at: { type: "string", description: "ISO 8601 datetime: end of execution window (Croner stopAt). Optional." },
      dom_and_dow: { type: "boolean", description: "If true, both day-of-month AND day-of-week must match (Croner domAndDow). Default: false (OR logic)" },
    },
    required: ["name", "task", "task_type"],
  },
  execute: async (params: Record<string, unknown>) => {
    const timezone = getUserTimezone();

    const name = params.name as string | undefined;
    const task = params.task as string | undefined;
    const task_type = params.task_type as "recurring" | "one_shot" | undefined;
    const cron_expression = params.cron_expression as string | undefined;
    const fire_at = params.fire_at as string | undefined;
    const payload = params.payload as Record<string, unknown> | undefined;
    const agent_id = params.agent_id as string | undefined;
    const tool_name = params.tool_name as string | undefined;
    const max_runs = params.max_runs as number | undefined;
    const channel = (params.channel as string) || "system";
    const start_at = params.start_at as string | undefined;
    const stop_at = params.stop_at as string | undefined;
    const dom_and_dow = params.dom_and_dow as boolean | undefined;

    if (!name) {
      return { ok: false, error: "Missing required field: name" };
    }

    if (!task) {
      return { ok: false, error: "Missing required field: task — provide the instruction the agent should execute" };
    }

    if (!task_type) {
      return { ok: false, error: "Missing required field: task_type (recurring or one_shot)" };
    }

    if (task_type === "recurring" && !cron_expression) {
      return { ok: false, error: "recurring task requires cron_expression" };
    }

    if (task_type === "one_shot" && !fire_at) {
      return { ok: false, error: "one_shot task requires fire_at" };
    }

    if (cron_expression) {
      try {
        new Cron(cron_expression);
      } catch (err) {
        return { ok: false, error: `Invalid cron expression: ${(err as Error).message}` };
      }
    }

    if (fire_at) {
      const fireAtDate = new Date(fire_at);
      if (fireAtDate.getTime() <= Date.now()) {
        return { ok: false, error: "fire_at must be in the future" };
      }
    }

    const payloadObj = payload && !payload._internal
      ? payload
      : { prompt: task, ...payload };

    try {
      if (_scheduler) {
        const result = _scheduler.create({
          name,
          task,
          task_type,
          cron_expression,
          fire_at,
          timezone,
          payload: payloadObj,
          agent_id: agent_id || null,
          tool_name: tool_name || null,
          max_runs: max_runs || null,
          channel,
          start_at: start_at || undefined,
          stop_at: stop_at || undefined,
          dom_and_dow: dom_and_dow || false,
        });

        log.info(`[create] Job "${name}" created via scheduler: ${result.id}`);

        return {
          ok: true,
          task_id: result.id,
          next_run: result.nextRun,
          message: `Job "${name}" scheduled. Next run: ${result.nextRun ? new Date(result.nextRun).toLocaleString() : "unknown"}`,
        };
      } else {
        const db = getDb();
        const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const now = new Date().toISOString();
        const payloadJson = JSON.stringify(payloadObj || { prompt: task });

        db.query(`
          INSERT INTO cron_jobs (
            id, name, task, task_type, cron_expression, fire_at, timezone,
            start_at, stop_at, dom_and_dow,
            payload, agent_id, tool_name, max_runs, channel,
            status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        `).run(
          id, name, task, task_type, cron_expression || null, fire_at || null, timezone,
          start_at || null, stop_at || null, dom_and_dow ? 1 : 0,
          payloadJson, agent_id || null, tool_name || null, max_runs || null, channel,
          now, now
        );

        return {
          ok: true,
          task_id: id,
          message: `Job "${name}" saved (scheduler not active)`,
        };
      }
    } catch (err) {
      log.error(`[create] Failed: ${(err as Error).message}`);
      return { ok: false, error: `Failed to create job: ${(err as Error).message}` };
    }
  },
};

// ─── cron.list ────────────────────────────────────────────────────────────────

export const cronListTool: Tool = {
  name: "cron.list",
  description: "List all cron jobs with their next execution times and status. Spanish: ver tareas programadas, listar cronograma",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["active", "paused", "completed", "failed", "cancelled"], description: "Filter by status" },
      task_type: { type: "string", enum: ["recurring", "one_shot"], description: "Filter by task type" },
    },
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();

    const status = params.status as string | undefined;
    const task_type = params.task_type as string | undefined;

    try {
      let query = "SELECT * FROM cron_jobs WHERE 1=1";
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
          task: t.task,
          type: t.task_type,
          status: t.status,
          cron_expression: t.cron_expression,
          fire_at: t.fire_at,
          start_at: t.start_at,
          stop_at: t.stop_at,
          next_run: t.next_run_at,
          last_run: t.last_run_at,
          run_count: t.run_count,
          channel: t.channel,
        })),
        count: tasks.length,
      };
    } catch (err) {
      log.error(`[list] Failed: ${(err as Error).message}`);
      return { ok: false, error: `Failed to list jobs: ${(err as Error).message}` };
    }
  },
};

// ─── cron.update ───────────────────────────────────────────────────────────────

export const cronUpdateTool: Tool = {
  name: "cron.update",
  description: "Update an existing cron job: change expression, task instruction, channel, time window, etc. Spanish: actualizar tarea programada, modificar cron, editar recordatorio",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID of the job to update" },
      name: { type: "string", description: "New name for the job" },
      task: { type: "string", description: "New instruction the agent reads when the job triggers" },
      cron_expression: { type: "string", description: "New cron expression (for recurring tasks)" },
      fire_at: { type: "string", description: "New fire_at datetime (for one_shot tasks)" },
      payload: { type: "object", description: "New payload object" },
      channel: { type: "string", description: "New notification channel" },
      max_runs: { type: "number", description: "New max executions limit" },
      start_at: { type: "string", description: "New start of execution window (ISO 8601)" },
      stop_at: { type: "string", description: "New end of execution window (ISO 8601)" },
      dom_and_dow: { type: "boolean", description: "Toggle AND logic for day-of-month + day-of-week" },
      agent_id: { type: "string", description: "New target agent ID" },
      tool_name: { type: "string", description: "New tool to execute" },
    },
    required: ["task_id"],
  },
  execute: async (params: Record<string, unknown>) => {
    const task_id = params.task_id as string | undefined;

    if (!task_id) {
      return { ok: false, error: "Missing required field: task_id" };
    }

    const changes: Record<string, unknown> = {};
    if (params.name !== undefined) changes.name = params.name;
    if (params.task !== undefined) changes.task = params.task;
    if (params.cron_expression !== undefined) changes.cron_expression = params.cron_expression;
    if (params.fire_at !== undefined) changes.fire_at = params.fire_at;
    if (params.payload !== undefined) changes.payload = params.payload;
    if (params.channel !== undefined) changes.channel = params.channel;
    if (params.max_runs !== undefined) changes.max_runs = params.max_runs;
    if (params.start_at !== undefined) changes.start_at = params.start_at;
    if (params.stop_at !== undefined) changes.stop_at = params.stop_at;
    if (params.dom_and_dow !== undefined) changes.dom_and_dow = params.dom_and_dow;
    if (params.agent_id !== undefined) changes.agent_id = params.agent_id;
    if (params.tool_name !== undefined) changes.tool_name = params.tool_name;

    if (Object.keys(changes).length === 0) {
      return { ok: false, error: "No fields to update. Provide at least one field besides task_id." };
    }

    try {
      if (_scheduler) {
        const success = _scheduler.update(task_id, changes);
        if (success) {
          return { ok: true, message: `Job "${task_id}" updated` };
        } else {
          return { ok: false, error: `Job "${task_id}" not found` };
        }
      } else {
        const db = getDb();
        const fields: string[] = [];
        const values: any[] = [];

        if (changes.name !== undefined) { fields.push("name = ?"); values.push(changes.name); }
        if (changes.task !== undefined) { fields.push("task = ?"); values.push(changes.task); }
        if (changes.cron_expression !== undefined) { fields.push("cron_expression = ?"); values.push(changes.cron_expression); }
        if (changes.fire_at !== undefined) { fields.push("fire_at = ?"); values.push(changes.fire_at); }
        if (changes.payload !== undefined) { fields.push("payload = ?"); values.push(JSON.stringify(changes.payload)); }
        if (changes.channel !== undefined) { fields.push("channel = ?"); values.push(changes.channel); }
        if (changes.max_runs !== undefined) { fields.push("max_runs = ?"); values.push(changes.max_runs); }
        if (changes.start_at !== undefined) { fields.push("start_at = ?"); values.push(changes.start_at); }
        if (changes.stop_at !== undefined) { fields.push("stop_at = ?"); values.push(changes.stop_at); }
        if (changes.dom_and_dow !== undefined) { fields.push("dom_and_dow = ?"); values.push(changes.dom_and_dow ? 1 : 0); }
        if (changes.agent_id !== undefined) { fields.push("agent_id = ?"); values.push(changes.agent_id); }
        if (changes.tool_name !== undefined) { fields.push("tool_name = ?"); values.push(changes.tool_name); }

        if (fields.length === 0) {
          return { ok: true, message: "No changes to apply" };
        }

        values.push(task_id);
        const result = db.query(`UPDATE cron_jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values);

        if (result.changes > 0) {
          return { ok: true, message: `Job "${task_id}" updated (scheduler not active)` };
        } else {
          return { ok: false, error: `Job "${task_id}" not found` };
        }
      }
    } catch (err) {
      log.error(`[update] Failed: ${(err as Error).message}`);
      return { ok: false, error: `Failed to update job: ${(err as Error).message}` };
    }
  },
};

// ─── cron.pause ───────────────────────────────────────────────────────────────

export const cronPauseTool: Tool = {
  name: "cron.pause",
  description: "Pause a cron job temporarily without deleting it. Spanish: pausar tarea programada, detener temporalmente",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID of the job to pause" },
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
          return { ok: true, message: `Job "${task_id}" paused` };
        } else {
          return { ok: false, error: `Job "${task_id}" not found or already paused` };
        }
      } else {
        const db = getDb();
        const result = db.query(
          "UPDATE cron_jobs SET status = 'paused' WHERE id = ?"
        ).run(task_id);

        if (result.changes > 0) {
          return { ok: true, message: `Job "${task_id}" paused (scheduler not active)` };
        } else {
          return { ok: false, error: `Job "${task_id}" not found` };
        }
      }
    } catch (err) {
      log.error(`[pause] Failed: ${(err as Error).message}`);
      return { ok: false, error: `Failed to pause job: ${(err as Error).message}` };
    }
  },
};

// ─── cron.resume ──────────────────────────────────────────────────────────────

export const cronResumeTool: Tool = {
  name: "cron.resume",
  description: "Resume a paused cron job. Spanish: reanudar tarea programada, continuar",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID of the job to resume" },
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
          return { ok: true, message: `Job "${task_id}" resumed` };
        } else {
          return { ok: false, error: `Job "${task_id}" not found or already active` };
        }
      } else {
        const db = getDb();
        const result = db.query(
          "UPDATE cron_jobs SET status = 'active' WHERE id = ?"
        ).run(task_id);

        if (result.changes > 0) {
          return { ok: true, message: `Job "${task_id}" resumed (scheduler not active)` };
        } else {
          return { ok: false, error: `Job "${task_id}" not found` };
        }
      }
    } catch (err) {
      log.error(`[resume] Failed: ${(err as Error).message}`);
      return { ok: false, error: `Failed to resume job: ${(err as Error).message}` };
    }
  },
};

// ─── cron.delete ──────────────────────────────────────────────────────────────

export const cronDeleteTool: Tool = {
  name: "cron.delete",
  description: "Delete a cron job permanently. Spanish: eliminar tarea programada, cancelar recordatorio",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID of the job to delete" },
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
          return { ok: true, message: `Job "${task_id}" deleted` };
        } else {
          return { ok: false, error: `Job "${task_id}" not found` };
        }
      } else {
        const db = getDb();
        const result = db.query(
          "DELETE FROM cron_jobs WHERE id = ?"
        ).run(task_id);

        if (result.changes > 0) {
          return { ok: true, message: `Job "${task_id}" deleted (scheduler not active)` };
        } else {
          return { ok: false, error: `Job "${task_id}" not found` };
        }
      }
    } catch (err) {
      log.error(`[delete] Failed: ${(err as Error).message}`);
      return { ok: false, error: `Failed to delete job: ${(err as Error).message}` };
    }
  },
};

// ─── cron.trigger ─────────────────────────────────────────────────────────────

export const cronTriggerTool: Tool = {
  name: "cron.trigger",
  description: "Manually trigger a cron job execution immediately. Spanish: ejecutar tarea ahora, forzar ejecución",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID of the job to trigger" },
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
          return { ok: true, message: `Job "${task_id}" triggered` };
        } else {
          return { ok: false, error: `Job "${task_id}" not found or not active` };
        }
      } else {
        return { ok: false, error: "Scheduler not active - cannot trigger jobs" };
      }
    } catch (err) {
      log.error(`[trigger] Failed: ${(err as Error).message}`);
      return { ok: false, error: `Failed to trigger job: ${(err as Error).message}` };
    }
  },
};

// ─── cron.history ─────────────────────────────────────────────────────────────

export const cronHistoryTool: Tool = {
  name: "cron.history",
  description: "Get execution history for a cron job. Spanish: historial de ejecuciones, logs de tarea",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "ID of the job" },
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
    cronUpdateTool,
    cronPauseTool,
    cronResumeTool,
    cronDeleteTool,
    cronTriggerTool,
    cronHistoryTool,
  ];
}

/**
 * Alias for backward compatibility
 */
export const createCronTools = createTools;