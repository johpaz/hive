/**
 * project_create - Create a new project with tasks in the database
 * 
 * @category projects
 * @seedId project_create
 * @spanish crear proyecto, nuevo proyecto, iniciar plan
 */

import type { Tool } from "../types.ts";
import { getDb } from "../../storage/sqlite.ts";
import { logger } from "../../utils/logger.ts";
import crypto from "crypto";

const log = logger.child("project-create");

export const projectCreateTool: Tool = {
  name: "project_create",
  description: "Create a new project with tasks in the database. Spanish: crear proyecto, nuevo proyecto, iniciar plan",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Nombre descriptivo del proyecto",
      },
      description: {
        type: "string",
        description: "Descripción detallada del objetivo del proyecto",
      },
      type: {
        type: "string",
        enum: ["general", "code", "research", "content", "data"],
        description: "Tipo de proyecto",
      },
      tasks: {
        type: "array",
        description: "Lista de tareas atómicas que componen el proyecto",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Nombre corto de la tarea" },
            description: { type: "string", description: "Qué debe hacer esta tarea" },
            agent_id: { type: "string", description: "ID del agente asignado (opcional)" },
          },
          required: ["name"],
        },
      },
    },
    required: ["name", "type"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const db = getDb();
    const name = params.name as string;
    const description = (params.description as string) ?? "";
    const type = (params.type as string) ?? "general";
    const tasks = (params.tasks as any[]) ?? [];
    const userId = config?.configurable?.user_id;
    const agentId = config?.configurable?.agent_id;

    try {
      const projectId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

      log.info(`Creating project: ${name}`);

      db.query(`
        INSERT INTO projects (id, user_id, agent_id, name, description, type, task, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())
      `).run(projectId, userId, agentId, name, description, type, description);

      const taskIds: number[] = [];
      for (const t of tasks) {
        const result = db.query(`
          INSERT INTO tasks (project_id, agent_id, name, description, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'pending', unixepoch(), unixepoch())
        `).run(projectId, t.agent_id ?? agentId, t.name, t.description ?? null);

        taskIds.push(result.lastInsertRowid as number);
      }

      return {
        ok: true,
        projectId,
        taskIds,
        message: `Project "${name}" created with ${tasks.length} task(s).`,
      };
    } catch (error) {
      log.error(`Failed to create project: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to create project: ${(error as Error).message}`,
      };
    }
  },
};
