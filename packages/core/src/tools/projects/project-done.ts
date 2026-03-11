/**
 * project_done - Mark project as completed
 * 
 * @category projects
 * @seedId project_done
 * @spanish proyecto terminado, cerrar proyecto, completado
 */

import type { Tool } from "../types.ts";
import { getDb } from "../../storage/sqlite.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("project-done");

export const projectDoneTool: Tool = {
  name: "project_done",
  description: "Mark project as completed and archive it. Spanish: proyecto terminado, cerrar proyecto, completado",
  parameters: {
    type: "object",
    properties: {
      projectId: {
        type: "string",
        description: "ID del proyecto completado",
      },
      summary: {
        type: "string",
        description: "Resumen final de lo logrado",
      },
    },
    required: ["projectId"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const projectId = params.projectId as string;
    const summary = (params.summary as string) ?? "Tarea completada exitosamente.";

    try {
      log.info(`Completing project ${projectId}`);

      const result = db.query(`
        UPDATE projects 
        SET status = 'done', progress = 100, updated_at = unixepoch(), completed_at = unixepoch(), context = ?
        WHERE id = ?
      `).run(summary, projectId);

      if (result.changes === 0) {
        return {
          ok: false,
          error: `Project not found: ${projectId}`,
        };
      }

      return {
        ok: true,
        projectId,
        message: "Project marked as completed.",
      };
    } catch (error) {
      log.error(`Failed to complete project: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to complete project: ${(error as Error).message}`,
      };
    }
  },
};
