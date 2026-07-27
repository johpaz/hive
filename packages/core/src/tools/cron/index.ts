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
import { col, toIndexable } from "../../storage/hive";
import type { UserDoc, UserIdentityDoc, ChannelDoc, CronJobDoc, TaskRunDoc } from "../../storage/collections";
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

async function getUserTimezone(): Promise<string> {
  const usersCol = await col<UserDoc>("users");
  const userEntry = (await usersCol.scan({ limit: 1 }))[0];
  return userEntry?.doc.timezone || "UTC";
}

export async function resolveBestChannel(userId: string, explicitChannel?: string): Promise<string> {
  const usersCol = await col<UserDoc>("users");
  const userEntry = await usersCol.get(userId);
  const preferredCronChannel = userEntry?.doc.preferred_cron_channel;

  const identitiesCol = await col<UserIdentityDoc>("userIdentities");
  const identityEntries = await identitiesCol.scan({ prefix: `${userId}:` });
  const allIdentityChannels = identityEntries.map(e => e.doc.channel);

  const channelsCol = await col<ChannelDoc>("channels");
  const activeChannels: string[] = [];
  for (const channel of new Set(allIdentityChannels)) {
    const channelEntry = await channelsCol.get(channel);
    if (channelEntry?.doc.active && channelEntry.doc.status === "connected") {
      activeChannels.push(channel);
    }
  }

  log.debug(`[resolveBestChannel] userId=${userId}, explicit=${explicitChannel}, preferred=${preferredCronChannel}, activeChannels=[${activeChannels.join(", ")}]`);

  const identities = activeChannels.length > 0 ? activeChannels : allIdentityChannels;

  if (identities.length === 0) {
    log.warn(`[resolveBestChannel] No identities found for user ${userId}, falling back to webchat`);
    return "webchat";
  }

  let bestChannel = "";

  if (explicitChannel && explicitChannel !== "system") {
    if (identities.includes(explicitChannel)) {
      bestChannel = explicitChannel;
      log.info(`[resolveBestChannel] Using explicit channel: ${bestChannel}`);
    }
  }

  if (!bestChannel && preferredCronChannel && preferredCronChannel !== "auto") {
    if (identities.includes(preferredCronChannel)) {
      bestChannel = preferredCronChannel;
      log.info(`[resolveBestChannel] Using preferred_cron_channel: ${bestChannel}`);
    } else {
      log.warn(`[resolveBestChannel] preferred_cron_channel=${preferredCronChannel} not in identities=[${identities.join(", ")}]`);
    }
  }

  if (!bestChannel) {
    const preferred = ["telegram", "discord", "slack", "whatsapp", "webchat"];
    for (const p of preferred) {
      if (identities.includes(p)) {
        bestChannel = p;
        log.info(`[resolveBestChannel] Using fallback priority: ${bestChannel}`);
        break;
      }
    }
  }

  if (!bestChannel) {
    bestChannel = identities[0];
    log.info(`[resolveBestChannel] Using first identity: ${bestChannel}`);
  }

  return bestChannel;
}

// ─── cron.create ─────────────────────────────────────────────────────────────

export const cronCreateTool: Tool = {
  name: "cron.create",
  description: "Create a Hive scheduled automation: a recurring cron job or one-shot future execution. Spanish: crear automatización programada, programar tarea recurrente, ejecutar después, programar reporte",
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
    const timezone = await getUserTimezone();

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
        const result = await _scheduler.create({
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
        const cronJobsCol = await col<CronJobDoc>("cronJobs");
        const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const now = new Date().toISOString();
        const payloadJson = JSON.stringify(payloadObj || { prompt: task });

        await cronJobsCol.put(id, {
          id, name, task, task_type,
          cron_expression: cron_expression || null,
          fire_at: fire_at || null,
          timezone,
          start_at: start_at || null,
          stop_at: stop_at || null,
          dom_and_dow: dom_and_dow ? 1 : 0,
          max_runs: max_runs || null,
          protect: 1,
          interval_sec: null,
          agent_id: toIndexable(agent_id || null),
          channel,
          payload: payloadJson,
          tool_name: tool_name || null,
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
    const status = params.status as string | undefined;
    const task_type = params.task_type as string | undefined;

    try {
      const cronJobsCol = await col<CronJobDoc>("cronJobs");
      let tasks = (await cronJobsCol.scan({})).map(e => e.doc);

      if (status) tasks = tasks.filter(t => t.status === status);
      if (task_type) tasks = tasks.filter(t => t.task_type === task_type);

      tasks.sort((a, b) => (a.next_run_at ?? "").localeCompare(b.next_run_at ?? ""));

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
        const success = await _scheduler.update(task_id, changes);
        if (success) {
          return { ok: true, message: `Job "${task_id}" updated` };
        } else {
          return { ok: false, error: `Job "${task_id}" not found` };
        }
      } else {
        const cronJobsCol = await col<CronJobDoc>("cronJobs");
        const existing = await cronJobsCol.get(task_id);
        if (!existing) {
          return { ok: false, error: `Job "${task_id}" not found` };
        }

        const patch: Partial<CronJobDoc> = {};
        if (changes.name !== undefined) patch.name = changes.name as string;
        if (changes.task !== undefined) patch.task = changes.task as string;
        if (changes.cron_expression !== undefined) patch.cron_expression = changes.cron_expression as string;
        if (changes.fire_at !== undefined) patch.fire_at = changes.fire_at as string;
        if (changes.payload !== undefined) patch.payload = JSON.stringify(changes.payload);
        if (changes.channel !== undefined) patch.channel = changes.channel as string;
        if (changes.max_runs !== undefined) patch.max_runs = changes.max_runs as number;
        if (changes.start_at !== undefined) patch.start_at = changes.start_at as string;
        if (changes.stop_at !== undefined) patch.stop_at = changes.stop_at as string;
        if (changes.dom_and_dow !== undefined) patch.dom_and_dow = changes.dom_and_dow ? 1 : 0;
        if (changes.agent_id !== undefined) patch.agent_id = toIndexable(changes.agent_id as string);
        if (changes.tool_name !== undefined) patch.tool_name = changes.tool_name as string;

        if (Object.keys(patch).length === 0) {
          return { ok: true, message: "No changes to apply" };
        }

        await cronJobsCol.put(task_id, { ...existing.doc, ...patch }, { expectedVersion: existing.version });

        return { ok: true, message: `Job "${task_id}" updated (scheduler not active)` };
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
        const success = await _scheduler.pause(task_id);
        if (success) {
          return { ok: true, message: `Job "${task_id}" paused` };
        } else {
          return { ok: false, error: `Job "${task_id}" not found or already paused` };
        }
      } else {
        const cronJobsCol = await col<CronJobDoc>("cronJobs");
        const existing = await cronJobsCol.get(task_id);
        if (!existing) {
          return { ok: false, error: `Job "${task_id}" not found` };
        }
        await cronJobsCol.put(task_id, { ...existing.doc, status: "paused" }, { expectedVersion: existing.version });
        return { ok: true, message: `Job "${task_id}" paused (scheduler not active)` };
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
        const success = await _scheduler.resume(task_id);
        if (success) {
          return { ok: true, message: `Job "${task_id}" resumed` };
        } else {
          return { ok: false, error: `Job "${task_id}" not found or already active` };
        }
      } else {
        const cronJobsCol = await col<CronJobDoc>("cronJobs");
        const existing = await cronJobsCol.get(task_id);
        if (!existing) {
          return { ok: false, error: `Job "${task_id}" not found` };
        }
        await cronJobsCol.put(task_id, { ...existing.doc, status: "active" }, { expectedVersion: existing.version });
        return { ok: true, message: `Job "${task_id}" resumed (scheduler not active)` };
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
        const success = await _scheduler.delete(task_id);
        if (success) {
          return { ok: true, message: `Job "${task_id}" deleted` };
        } else {
          return { ok: false, error: `Job "${task_id}" not found` };
        }
      } else {
        const cronJobsCol = await col<CronJobDoc>("cronJobs");
        const existing = await cronJobsCol.get(task_id);
        if (!existing) {
          return { ok: false, error: `Job "${task_id}" not found` };
        }
        await cronJobsCol.delete(task_id);
        return { ok: true, message: `Job "${task_id}" deleted (scheduler not active)` };
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
      const taskRunsCol = await col<TaskRunDoc>("taskRuns");
      const runs = (await taskRunsCol.scan({}))
        .map(e => e.doc)
        .filter(r => r.task_id === task_id)
        .sort((a, b) => b.started_at.localeCompare(a.started_at))
        .slice(0, limit);

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
