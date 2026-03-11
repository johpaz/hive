/**
 * task_create - Add a task or subtask to an existing project
 * 
 * @category projects
 * @seedId task_create
 * @spanish crear tarea, agregar tarea, subtarea, pendiente
 */

import type { Tool } from "../types.ts";
import { getDb } from "../../storage/sqlite.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("task-create");

export const taskCreateTool: Tool = {
  name: "task_create",
  description: "Add a task or subtask to an existing project. Spanish: crear tarea, agregar tarea, subtarea, pendiente",
  parameters: {
    type: "object",
    properties: {
      project_id: {
        type: "string",
        description: "ID del proyecto al que pertenece la tarea",
      },
      name: {
        type: "string",
        description: "Nombre corto de la tarea",
      },
      description: {
        type: "string",
        description: "Qué debe realizar esta tarea",
      },
      agent_id: {
        type: "string",
        description: "ID del agente responsable (opcional)",
      },
    },
    required: ["project_id", "name"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const projectId = params.project_id as string;
    const name = params.name as string;
    const description = (params.description as string) ?? null;
    const agentId = (params.agent_id as string) ?? null;

    try {
      const result = db.query(`
        INSERT INTO tasks (project_id, agent_id, name, description, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', unixepoch(), unixepoch())
      `).run(projectId, agentId, name, description);

      const taskId = result.lastInsertRowid as number;

      return {
        ok: true,
        taskId,
        message: `Task "${name}" created (ID: ${taskId}).`,
      };
    } catch (error) {
      log.error(`Failed to create task: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to create task: ${(error as Error).message}`,
      };
    }
  },
};
