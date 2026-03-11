/**
 * project_fail - Mark project as failed
 * 
 * @category projects
 * @seedId project_fail
 * @spanish proyecto fallido, marcar fracaso, error
 */

import type { Tool } from "../types.ts";
import { getDb } from "../../storage/sqlite.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("project-fail");

export const projectFailTool: Tool = {
  name: "project_fail",
  description: "Mark project as failed and record reason. Spanish: proyecto fallido, marcar fracaso, error",
  parameters: {
    type: "object",
    properties: {
      projectId: {
        type: "string",
        description: "ID del proyecto fallido",
      },
      reason: {
        type: "string",
        description: "Razón del fallo",
      },
    },
    required: ["projectId", "reason"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const projectId = params.projectId as string;
    const reason = params.reason as string;

    try {
      log.error(`Project ${projectId} failed: ${reason}`);

      const result = db.query(`
        UPDATE projects 
        SET status = 'failed', updated_at = unixepoch(), context = ? 
        WHERE id = ?
      `).run(reason, projectId);

      if (result.changes === 0) {
        return {
          ok: false,
          error: `Project not found: ${projectId}`,
        };
      }

      return {
        ok: true,
        projectId,
        message: "Project marked as failed.",
      };
    } catch (error) {
      log.error(`Failed to mark project as failed: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to mark project as failed: ${(error as Error).message}`,
      };
    }
  },
};
