/**
 * project_list - List all projects with their status
 * 
 * @category projects
 * @seedId project_list
 * @spanish listar proyectos, ver proyectos, historial
 */

import type { Tool } from "../types.ts";
import { getDb } from "../../storage/sqlite.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("project-list");

export const projectListTool: Tool = {
  name: "project_list",
  description: "List all projects with their status. Spanish: listar proyectos, ver proyectos, historial",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["active", "done", "failed", "all"],
        description: "Filter by status (default: all)",
      },
      limit: {
        type: "number",
        description: "Maximum results (default: 20)",
      },
    },
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const db = getDb();
    const userId = config?.configurable?.user_id;
    const statusFilter = params.status as string | undefined;
    const limit = (params.limit as number) ?? 20;

    try {
      let query = `
        SELECT id, name, description, type, status, progress, created_at, updated_at
        FROM projects
        WHERE user_id = ?
      `;
      const args: any[] = [userId];

      if (statusFilter && statusFilter !== "all") {
        query += ` AND status = ?`;
        args.push(statusFilter);
      }

      query += ` ORDER BY updated_at DESC LIMIT ?`;
      args.push(limit);

      const rows = db.query(query).all(...args) as any[];

      const projects = rows.map((row) => {
        const tasks = db.query(`
          SELECT id, name, description, status, progress, agent_id, result
          FROM tasks WHERE project_id = ? ORDER BY id ASC
        `).all(row.id) as any[];

        return {
          id: row.id,
          name: row.name,
          description: row.description,
          type: row.type,
          status: row.status,
          progress: row.progress,
          createdAt: new Date(row.created_at * 1000).toISOString(),
          updatedAt: new Date(row.updated_at * 1000).toISOString(),
          tasks: tasks.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
            status: t.status,
            progress: t.progress,
            agentId: t.agent_id,
            result: t.result,
          })),
        };
      });

      return {
        ok: true,
        projects,
        count: projects.length,
      };
    } catch (error) {
      log.error(`Failed to list projects: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to list projects: ${(error as Error).message}`,
      };
    }
  },
};
