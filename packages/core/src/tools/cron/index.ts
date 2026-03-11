/**
 * Cron Tools - 4 tools
 * 
 * @category cron
 */

import type { Tool } from "../types.ts";
import { getDb } from "../../storage/sqlite.ts";
import { logger } from "../../utils/logger.ts";
import { Cron } from "croner";

const log = logger.child("cron");

// ─── cron_add ────────────────────────────────────────────────────────────────

export const cronAddTool: Tool = {
  name: "cron_add",
  description: "Schedule a recurring or one-time job using a cron expression. Spanish: programar tarea, recordatorio, alarma, automatizar horario",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Nombre de la tarea programada" },
      cronExpression: { type: "string", description: "Expresión cron (5 campos: minuto hora día mes weekday)" },
      taskType: { type: "string", description: "Tipo de tarea (message, project, etc.)" },
      taskConfig: { type: "object", description: "Configuración de la tarea" },
      maxRuns: { type: "number", description: "Máximo de ejecuciones. Usa 1 para tareas de una sola vez (one-shot). Omitir para recurrentes." },
    },
    required: ["name", "cronExpression"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const db = getDb();
    const userId = config?.configurable?.user_id;
    const name = (params.name || params.taskName || params.title || params.task) as string | undefined;
    const cronExpression = (params.cronExpression || params.cron_expression || params.expression) as string | undefined;
    const taskType = (params.taskType as string) ?? "message";
    const taskConfig = params.taskConfig as Record<string, unknown> | undefined;
    const maxRuns = params.maxRuns as number | undefined;

    if (!name) {
      return { ok: false, error: "Missing required field: name (job name)" };
    }
    if (!cronExpression) {
      return { ok: false, error: "Missing required field: cronExpression (e.g. '0 9 * * *')" };
    }

    try {
      // Validate and calculate next run
      const cronInstance = new Cron(cronExpression);
      const nextDate = cronInstance.nextRun();
      cronInstance.stop(); // Solo era para calcular, el scheduler real lo relanzará
      const nextRun = nextDate ? Math.floor(nextDate.getTime() / 1000) : null;

      const jobId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

      db.query(`
        INSERT INTO cron_jobs (id, user_id, name, cron_expression, task_type, task_config, max_runs, enabled, next_run, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, unixepoch())
      `).run(jobId, userId, name, cronExpression, taskType, JSON.stringify(taskConfig ?? {}), maxRuns ?? null, nextRun);

      return {
        ok: true,
        jobId,
        nextRun: nextDate?.toISOString() ?? null,
        message: `Cron job "${name}" scheduled. Next run: ${nextDate?.toLocaleString() ?? "unknown"}`,
      };
    } catch (error) {
      log.error(`Failed to add cron: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Invalid cron expression or database error: ${(error as Error).message}`,
      };
    }
  },
};

// ─── cron_list ───────────────────────────────────────────────────────────────

export const cronListTool: Tool = {
  name: "cron_list",
  description: "List all scheduled cron jobs and next execution times. Spanish: ver tareas programadas, cronograma, próximos eventos",
  parameters: {
    type: "object",
    properties: {
      enabled: { type: "boolean", description: "Filter by enabled status" },
    },
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const db = getDb();
    const userId = config?.configurable?.user_id;
    const enabledFilter = params.enabled as boolean | undefined;

    try {
      let query = "SELECT * FROM cron_jobs WHERE user_id = ?";
      const args: any[] = [userId];

      if (enabledFilter !== undefined) {
        query += " AND enabled = ?";
        args.push(enabledFilter ? 1 : 0);
      }

      query += " ORDER BY next_run ASC";

      const jobs = db.query(query).all(...args) as any[];

      return {
        ok: true,
        jobs: jobs.map((j) => ({
          id: j.id,
          name: j.name,
          cronExpression: j.cron_expression,
          taskType: j.task_type,
          enabled: j.enabled === 1,
          runCount: j.run_count,
          nextRun: j.next_run ? new Date(j.next_run * 1000).toISOString() : null,
        })),
        count: jobs.length,
      };
    } catch (error) {
      log.error(`Failed to list crons: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to list cron jobs: ${(error as Error).message}`,
      };
    }
  },
};

// ─── cron_edit ───────────────────────────────────────────────────────────────

export const cronEditTool: Tool = {
  name: "cron_edit",
  description: "Edit an existing cron job expression or config. Spanish: modificar horario, cambiar programación, editar cron",
  parameters: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "ID del cron job" },
      cronExpression: { type: "string", description: "Nueva expresión cron" },
      taskConfig: { type: "object", description: "Nueva configuración" },
    },
    required: ["jobId"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const jobId = params.jobId as string;
    const cronExpression = params.cronExpression as string | undefined;
    const taskConfig = params.taskConfig as Record<string, unknown> | undefined;

    try {
      const updates: string[] = [];
      const values: any[] = [];

      if (cronExpression) {
        // Validate and recalculate next_run with new expression
        const cronInstance = new Cron(cronExpression);
        const nextDate = cronInstance.nextRun();
        cronInstance.stop();
        const nextRun = nextDate ? Math.floor(nextDate.getTime() / 1000) : null;

        updates.push("cron_expression = ?");
        values.push(cronExpression);
        updates.push("next_run = ?");
        values.push(nextRun);
      }

      if (taskConfig !== undefined) {
        updates.push("task_config = ?");
        values.push(JSON.stringify(taskConfig));
      }

      if (updates.length === 0) {
        return { ok: false, error: "No changes provided" };
      }

      values.push(jobId);

      const result = db.query(`UPDATE cron_jobs SET ${updates.join(", ")} WHERE id = ?`).run(...values);

      if (result.changes === 0) {
        return { ok: false, error: `Cron job not found: ${jobId}` };
      }

      // Stop and remove the active croner instance so it gets rescheduled
      // with the new expression on the next loadAndSchedule poll (every 30s)
      const existing = activeJobs.get(jobId);
      if (existing) {
        existing.stop();
        activeJobs.delete(jobId);
        log.info(`[cron] Stopped active instance for job ${jobId} — will reschedule with new expression`);
      }

      return { ok: true, jobId, message: "Cron job updated and rescheduled." };
    } catch (error) {
      log.error(`Failed to edit cron: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to edit cron job: ${(error as Error).message}`,
      };
    }
  },
};

// ─── cron_remove ─────────────────────────────────────────────────────────────

export const cronRemoveTool: Tool = {
  name: "cron_remove",
  description: "Remove a scheduled cron job. Spanish: eliminar cron, cancelar recordatorio, borrar programación",
  parameters: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "ID del cron job a eliminar" },
    },
    required: ["jobId"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const jobId = params.jobId as string;

    try {
      const result = db.query("DELETE FROM cron_jobs WHERE id = ?").run(jobId);

      if (result.changes === 0) {
        return { ok: false, error: `Cron job not found: ${jobId}` };
      }

      return { ok: true, jobId, message: "Cron job removed." };
    } catch (error) {
      log.error(`Failed to remove cron: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to remove cron job: ${(error as Error).message}`,
      };
    }
  },
};

import crypto from "crypto";

export function createTools(): Tool[] {
  return [cronAddTool, cronListTool, cronEditTool, cronRemoveTool];
}

// Mapa de instancias Cron activas: jobId → Cron instance
const activeJobs = new Map<string, InstanceType<typeof Cron>>();

type CronCallback = (sessionId: string, task: string, jobId: string, context: { fecha_usuario: string; hora_usuario: string }) => void;

function scheduleJob(
  job: { id: string; user_id: string; name: string; cron_expression: string; max_runs: number | null; run_count: number; expires_at: number | null },
  callback: CronCallback
): void {
  // Si ya hay una instancia activa para este job, la saltamos
  if (activeJobs.has(job.id)) return;

  try {
    const instance = new Cron(job.cron_expression, { protect: true }, () => {
      const db = getDb();
      const now = Math.floor(Date.now() / 1000);

      // Verificar expiración
      if (job.expires_at && now > job.expires_at) {
        log.info(`[cron] Job "${job.name}" (${job.id}) expired, stopping`);
        instance.stop();
        activeJobs.delete(job.id);
        db.query("UPDATE cron_jobs SET enabled = 0 WHERE id = ?").run(job.id);
        return;
      }

      // Actualizar run_count, last_run, next_run
      const newRunCount = (job.run_count ?? 0) + 1;
      const nextDate = instance.nextRun();
      const nextRunTs = nextDate ? Math.floor(nextDate.getTime() / 1000) : null;

      db.query(
        "UPDATE cron_jobs SET run_count = ?, last_run = ?, next_run = ? WHERE id = ?"
      ).run(newRunCount, now, nextRunTs, job.id);
      job.run_count = newRunCount;

      // Verificar max_runs
      if (job.max_runs !== null && newRunCount >= job.max_runs) {
        log.info(`[cron] Job "${job.name}" (${job.id}) reached max_runs=${job.max_runs}, stopping`);
        instance.stop();
        activeJobs.delete(job.id);
        db.query("UPDATE cron_jobs SET enabled = 0 WHERE id = ?").run(job.id);
        return;
      }

      // Auto-desactivar si no hay próxima ejecución en los próximos 366 días
      // (detecta expresiones one-shot como "0 19 9 3 *" que croner reprograma al año siguiente)
      if (!nextDate || nextDate.getTime() - Date.now() > 366 * 24 * 60 * 60 * 1000) {
        log.info(`[cron] Job "${job.name}" (${job.id}) has no near future run (next=${nextDate?.toISOString() ?? "null"}), disabling`);
        instance.stop();
        activeJobs.delete(job.id);
        db.query("UPDATE cron_jobs SET enabled = 0 WHERE id = ?").run(job.id);
        return;
      }

      // Contexto de fecha/hora local
      const now_date = new Date();
      const context = {
        fecha_usuario: now_date.toLocaleDateString("es-ES"),
        hora_usuario: now_date.toLocaleTimeString("es-ES"),
      };

      log.info(`[cron] Firing job "${job.name}" (${job.id}) run #${newRunCount}`);
      callback(job.user_id, job.name, job.id, context);
    });

    activeJobs.set(job.id, instance);

    // Actualizar next_run inicial en BD
    const nextDate = instance.nextRun();
    if (nextDate) {
      getDb()
        .query("UPDATE cron_jobs SET next_run = ? WHERE id = ?")
        .run(Math.floor(nextDate.getTime() / 1000), job.id);
    }

    log.info(`[cron] Scheduled job "${job.name}" (${job.id}) — next: ${instance.nextRun()?.toISOString() ?? "unknown"}`);
  } catch (err) {
    log.error(`[cron] Failed to schedule job "${job.name}" (${job.id}): ${(err as Error).message}`);
  }
}

/**
 * Initialize the cron scheduler.
 * Loads all enabled jobs from the DB and schedules them.
 * Polls every 30s for new jobs added after startup.
 */
export function initCronScheduler(callback: CronCallback): void {
  const db = getDb();

  const loadAndSchedule = () => {
    const jobs = db.query(`
      SELECT id, user_id, name, cron_expression, max_runs, run_count, expires_at
      FROM cron_jobs
      WHERE enabled = 1
    `).all() as { id: string; user_id: string; name: string; cron_expression: string; max_runs: number | null; run_count: number; expires_at: number | null }[];

    for (const job of jobs) {
      scheduleJob(job, callback);
    }

    // Detener jobs que ya no están en BD o están deshabilitados
    const activeIds = new Set(jobs.map((j) => j.id));
    for (const [jobId, instance] of activeJobs) {
      if (!activeIds.has(jobId)) {
        log.info(`[cron] Stopping removed/disabled job ${jobId}`);
        instance.stop();
        activeJobs.delete(jobId);
      }
    }
  };

  // Carga inicial
  loadAndSchedule();

  // Poll cada 30s para detectar nuevos jobs o jobs eliminados
  setInterval(loadAndSchedule, 30_000);

  log.info(`[cron] Scheduler initialized with ${activeJobs.size} active jobs`);
}

/**
 * Resolve the best channel TYPE ("webchat", "telegram", etc.) for cron notifications.
 * Priority: explicit notify_channel_id → user_identities (first registered) → "webchat"
 */
export function resolveBestChannel(userId: string, notifyChannelId?: string | null): string {
  // 1. Explicit channel set on the job
  if (notifyChannelId) return notifyChannelId;

  // 2. Look up which channels the user has registered identities for
  try {
    const db = getDb();
    const identities = db.query<{ channel: string }, [string]>(
      "SELECT channel FROM user_identities WHERE user_id = ? ORDER BY channel ASC LIMIT 5"
    ).all(userId);

    // Prefer telegram if available (most reliable for async notifications)
    const preferred = ["telegram", "discord", "slack", "whatsapp"];
    for (const p of preferred) {
      if (identities.some((i) => i.channel === p)) return p;
    }
  } catch {
    // DB not ready or no identities — fall through
  }

  // 3. Default to webchat
  return "webchat";
}
