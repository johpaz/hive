/**
 * project_update - Update project progress or metadata
 * 
 * @category projects
 * @seedId project_update
 * @spanish actualizar proyecto, avance, porcentaje, estado
 */

import type { Tool } from "../types.ts";
import { getDb } from "../../storage/sqlite.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("project-update");

export const projectUpdateTool: Tool = {
  name: "project_update",
  description: "Update project progress or metadata. Spanish: actualizar proyecto, avance, porcentaje, estado",
  parameters: {
    type: "object",
    properties: {
      projectId: {
        type: "string",
        description: "ID del proyecto a actualizar",
      },
      progress: {
        type: "number",
        description: "Progreso actual (0-100)",
      },
      stepDescription: {
        type: "string",
        description: "Descripción del paso actual o siguiente",
      },
    },
    required: ["projectId", "progress", "stepDescription"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const projectId = params.projectId as string;
    const progress = params.progress as number;
    const stepDescription = params.stepDescription as string;

    try {
      log.info(`Updating project ${projectId}: ${progress}%`);

      const result = db.query(`
        UPDATE projects 
        SET progress = ?, context = ?, updated_at = unixepoch() 
        WHERE id = ?
      `).run(progress, stepDescription, projectId);

      if (result.changes === 0) {
        return {
          ok: false,
          error: `Project not found: ${projectId}`,
        };
      }

      return {
        ok: true,
        projectId,
        progress,
        message: `Project updated: ${progress}%`,
      };
    } catch (error) {
      log.error(`Failed to update project: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to update project: ${(error as Error).message}`,
      };
    }
  },
};
