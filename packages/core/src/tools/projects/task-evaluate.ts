/**
 * task_evaluate - Evaluate task result against acceptance criteria
 * 
 * @category projects
 * @seedId task_evaluate
 * @spanish evaluar tarea, validar resultado, criterios de aceptación
 */

import type { Tool } from "../types.ts";
import { getDb } from "../../storage/sqlite.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("task-evaluate");

export const taskEvaluateTool: Tool = {
  name: "task_evaluate",
  description: "Evaluate task result against acceptance criteria. Spanish: evaluar tarea, validar resultado, criterios de aceptación",
  parameters: {
    type: "object",
    properties: {
      task_id: {
        type: "number",
        description: "ID numérico de la tarea a evaluar",
      },
      criteria: {
        type: "array",
        description: "Lista de criterios de aceptación",
        items: { type: "string" },
      },
      auto_update: {
        type: "boolean",
        description: "Si pasa la evaluación, marca la tarea como completed (default: false)",
      },
    },
    required: ["task_id", "criteria"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const taskId = params.task_id as number;
    const criteria = params.criteria as string[];
    const autoUpdate = (params.auto_update as boolean) ?? false;

    try {
      const task = db.query<any, [number]>(
        "SELECT id, name, status, result FROM tasks WHERE id = ?"
      ).get(taskId);

      if (!task) {
        return {
          ok: false,
          error: `Task not found: ${taskId}`,
        };
      }

      if (!task.result) {
        return {
          ok: false,
          error: `Task has no result to evaluate.`,
        };
      }

      const evaluations = criteria.map((criterion) => {
        const passed = task.result.toLowerCase().includes(criterion.toLowerCase());
        return { criterion, passed };
      });

      const allPassed = evaluations.every((e) => e.passed);
      const passedCount = evaluations.filter((e) => e.passed).length;

      if (autoUpdate && allPassed) {
        db.query(`
          UPDATE tasks SET status = 'completed', completed_at = unixepoch() WHERE id = ?
        `).run(taskId);
      }

      return {
        ok: true,
        taskId,
        allPassed,
        passedCount,
        totalCriteria: criteria.length,
        evaluations,
        autoUpdated: autoUpdate && allPassed,
      };
    } catch (error) {
      log.error(`Failed to evaluate task: ${(error as Error).message}`);
      return {
        ok: false,
        error: `Failed to evaluate task: ${(error as Error).message}`,
      };
    }
  },
};
