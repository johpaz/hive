/**
 * task_update - Update task status
 * 
 * @category projects
 * @seedId task_update
 * @spanish actualizar tarea, marcar completa, en progreso
 */

import type { Tool } from "../types.ts";
import { getDb } from "../../storage/sqlite.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("task-update");

export const taskUpdateTool: Tool = {
  name: "task_update",
  description: "Update task status (pending, in_progress, done). Spanish: actualizar tarea, marcar completa, en progreso",
  parameters: {
    type: "object",
    properties: {
      task_id: {
        type: "number",
        description: "ID numérico de la tarea",
      },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "completed", "failed", "blocked"],
        description: "Nuevo estado de la tarea",
      },
      progress: {
        type: "number",
        description: "Progreso de la tarea (0-100)",
      },
      result: {
        type: "string",
        description: "Resultado o output de la tarea",
      },
    },
    required: ["task_id"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const taskId = params.task_id as number;
    const status = params.status as string | undefined;
    const progress = params.progress as number | undefined;
    const result = params.result as string | undefined;

    try {
      log.info(`Updating task ${taskId}`);

      const updates: string[] = [];
      const values: any[] = [];

      if (status !== undefined) {
        updates.push("status = ?");
        values.push(status);
      }
      if (progress !== undefined) {
        updates.push("progress = ?");
        values.push(progress);
      }
      if (result !== undefined) {
        updates.push("result = ?");
        values.push(result);
      }

      updates.push("updated_at = unixepoch()");
      values.push(taskId);

      const query = `UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`;
      const updateResult = db.query(query).run(...values);

      if (updateResult.changes === 0) {
        return {
          ok: false,
          error: `Task not found: ${taskId}`,
        };
      }

      return {
        ok: true,
        taskId,
        message: `Task ${taskId} updated.`,
      };
    } catch (error) {
      log.error(`Failed to update task: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to update task: ${(error as Error).message}`,
      };
    }
  },
};
