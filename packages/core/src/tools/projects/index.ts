/**
 * Project & Task management tools — durable project/task engine.
 *
 * project_create: creates a ProjectDoc
 * task_create: creates a TaskDoc with optional depends_on (validated for cycles)
 * project_status: returns project + all tasks with their status/progress
 *
 * The actual execution is driven by TaskDriver (scheduler/task-driver.ts)
 * which picks up tasks with completed deps and enqueues project_task jobs
 * in the durable queue.
 */

import type { Tool } from "../types.ts";
import { col, nextId, toIndexable, fromIndexable } from "../../storage/hive.ts";
import type { ProjectDoc, TaskDoc, AgentDoc } from "../../storage/collections.ts";
import { logger } from "../../utils/logger.ts";

const log = logger.child("projects");

// ─── project_create ──────────────────────────────────────────────────────────

export const projectCreateTool: Tool = {
  name: "project_create",
  description: "Create a new project. Spanish: crear proyecto, nuevo proyecto, iniciar proyecto",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Project name" },
      description: { type: "string", description: "Project description" },
      type: { type: "string", description: "Project type (build, research, deploy, etc.)" },
      agent_id: { type: "string", description: "Coordinator agent ID (optional)" },
    },
    required: ["name"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const name = params.name as string;
    const description = (params.description as string) ?? null;
    const type = (params.type as string) ?? "general";
    const agentId = (params.agent_id as string) ?? null;
    const userId = config?.configurable?.user_id ?? "";

    try {
      const id = await nextId("projects");
      const now = Date.now();
      const projectsCol = await col<ProjectDoc>("projects");
      await projectsCol.put(id, {
        id,
        user_id: userId,
        agent_id: toIndexable(agentId),
        name,
        description,
        type,
        task: null,
        progress: 0,
        status: "pending",
        context: null,
        parent_id: toIndexable(null),
        created_at: now,
        updated_at: now,
        started_at: null,
        completed_at: null,
      }, { expectedVersion: 0 });

      return {
        ok: true,
        project_id: id,
        name,
        message: `Project "${name}" created (id=${id}).`,
      };
    } catch (error) {
      return { ok: false, error: `Failed to create project: ${(error as Error).message}` };
    }
  },
};

// ─── task_create ────────────────────────────────────────────────────────────

export const taskCreateTool: Tool = {
  name: "task_create",
  description: "Create a task within a project, optionally with dependencies. Spanish: crear tarea, nueva tarea, agregar subtarea",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "Project ID" },
      name: { type: "string", description: "Task name" },
      description: { type: "string", description: "Task description / instructions" },
      agent_id: { type: "string", description: "Worker agent ID (optional)" },
      depends_on: {
        type: "array",
        description: "Task IDs this task depends on (must complete first)",
        items: { type: "string" },
      },
      priority: { type: "number", description: "Priority (higher = more urgent, default 0)" },
    },
    required: ["project_id", "name"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const projectId = params.project_id as string;
    const name = params.name as string;
    const description = (params.description as string) ?? null;
    const agentId = (params.agent_id as string) ?? null;
    const dependsOn = (params.depends_on as string[]) ?? null;
    const priority = (params.priority as number) ?? 0;

    try {
      // Verify project exists
      const projectsCol = await col<ProjectDoc>("projects");
      const projectEntry = await projectsCol.get(projectId);
      if (!projectEntry) {
        return { ok: false, error: `Project not found: ${projectId}` };
      }

      // Validate dependency graph (no cycles) if depends_on provided
      if (dependsOn && dependsOn.length > 0) {
        try {
          const tasksCol = await col<TaskDoc>("tasks");
          const existingTasks = (await tasksCol.findBy("project_id", projectId)).map((e) => e.doc);
          const allTaskIds = new Set(existingTasks.map((t) => t.id));
          for (const dep of dependsOn) {
            if (!allTaskIds.has(dep)) {
              return { ok: false, error: `Dependency task "${dep}" not found in project ${projectId}` };
            }
          }
          // Build adjacency list for cycle detection (DFS)
          const adj = new Map<string, string[]>();
          for (const t of existingTasks) {
            adj.set(t.id, t.depends_on ? JSON.parse(t.depends_on) : []);
          }
          adj.set("__new__", dependsOn);

          // Three-color DFS: 0=white, 1=gray, 2=black
          const color = new Map<string, number>();
          for (const id of adj.keys()) color.set(id, 0);
          let hasCycle = false;
          const visit = (id: string): void => {
            if (hasCycle) return;
            color.set(id, 1);
            const deps = adj.get(id) ?? [];
            for (const dep of deps) {
              const c = color.get(dep) ?? 0;
              if (c === 1) { hasCycle = true; return; }
              if (c === 0) visit(dep);
            }
            color.set(id, 2);
          };
          for (const id of adj.keys()) {
            if (color.get(id) === 0) visit(id);
          }
          if (hasCycle) {
            return { ok: false, error: "Dependency cycle detected — cannot create circular task dependencies" };
          }
        } catch (err) {
          return { ok: false, error: `Dependency validation failed: ${(err as Error).message}` };
        }
      }

      const id = await nextId("tasks");
      const now = Date.now();
      const tasksCol = await col<TaskDoc>("tasks");
      await tasksCol.put(id, {
        id,
        project_id: projectId,
        agent_id: toIndexable(agentId),
        parent_task_id: null,
        name,
        description,
        status: "pending",
        progress: 0,
        priority,
        depends_on: dependsOn ? JSON.stringify(dependsOn) : null,
        result: null,
        error: null,
        metadata: null,
        job_id: null,
        run_id: null,
        thread_id: null,
        specialist_id: toIndexable(null),
        started_at: null,
        attempts: 0,
        created_at: now,
        updated_at: now,
        completed_at: null,
      }, { expectedVersion: 0 });

      // Update project status → active
      if (projectEntry.doc.status === "pending") {
        await projectsCol.put(projectId, {
          ...projectEntry.doc,
          status: "active",
          started_at: now,
          updated_at: now,
        }, { expectedVersion: projectEntry.version });
      }

      // Kick the driver so dependency-free tasks start without waiting for
      // the 10s poll.
      try {
        const { getTaskDriver } = await import("../../scheduler/task-driver.ts");
        void getTaskDriver().kick("task_create");
      } catch { /* driver not initialized (e.g. tests) */ }

      return {
        ok: true,
        task_id: id,
        project_id: projectId,
        name,
        depends_on: dependsOn,
        message: `Task "${name}" created (id=${id}).`,
      };
    } catch (error) {
      return { ok: false, error: `Failed to create task: ${(error as Error).message}` };
    }
  },
};

// ─── task_complete ───────────────────────────────────────────────────────────

export const taskCompleteTool: Tool = {
  name: "task_complete",
  description: "Mark a project task as completed (or failed) manually, unblocking its dependents. Spanish: completar tarea, marcar tarea lista, cerrar tarea",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "Task ID" },
      result: { type: "string", description: "Result summary (optional)" },
      failed: { type: "boolean", description: "Mark as failed instead of completed" },
      error: { type: "string", description: "Error description when failed=true" },
    },
    required: ["task_id"],
  },
  execute: async (params: Record<string, unknown>) => {
    const taskId = params.task_id as string;
    const result = (params.result as string) ?? null;
    const failed = params.failed === true;
    const error = (params.error as string) ?? null;

    try {
      const tasksCol = await col<TaskDoc>("tasks");
      const entry = await tasksCol.get(taskId);
      if (!entry) {
        return { ok: false, error: `Task not found: ${taskId}` };
      }
      const task = entry.doc;
      if (task.status === "completed") {
        return { ok: true, task_id: taskId, status: "completed", message: "Task was already completed." };
      }

      const now = Date.now();
      await tasksCol.put(taskId, {
        ...task,
        status: failed ? "failed" : "completed",
        progress: failed ? task.progress : 100,
        result: result ?? task.result,
        error: failed ? (error ?? "Marked as failed") : null,
        completed_at: failed ? null : now,
        updated_at: now,
      }, { expectedVersion: entry.version });

      // Kick the driver so dependent tasks get evaluated right away
      try {
        const { getTaskDriver } = await import("../../scheduler/task-driver.ts");
        void getTaskDriver().kick("task_complete");
      } catch { /* driver not initialized (e.g. tests) */ }

      return {
        ok: true,
        task_id: taskId,
        status: failed ? "failed" : "completed",
        message: `Task "${task.name}" marked as ${failed ? "failed" : "completed"}.`,
      };
    } catch (err) {
      return { ok: false, error: `Failed to complete task: ${(err as Error).message}` };
    }
  },
};

// ─── project_status ──────────────────────────────────────────────────────────

export const projectStatusTool: Tool = {
  name: "project_status",
  description: "Get project status and all its tasks. Spanish: estado proyecto, ver tareas, progreso proyecto",
  parameters: {
    type: "object",
    properties: {
      project_id: { type: "string", description: "Project ID" },
    },
    required: ["project_id"],
  },
  execute: async (params: Record<string, unknown>) => {
    const projectId = params.project_id as string;

    try {
      const projectsCol = await col<ProjectDoc>("projects");
      const projectEntry = await projectsCol.get(projectId);
      if (!projectEntry) {
        return { ok: false, error: `Project not found: ${projectId}` };
      }
      const project = projectEntry.doc;

      const tasksCol = await col<TaskDoc>("tasks");
      const taskEntries = await tasksCol.findBy("project_id", projectId);
      const tasks = taskEntries.map((e) => e.doc);

      const byStatus = tasks.reduce((acc, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const overallProgress = tasks.length > 0
        ? Math.round(tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length)
        : 0;

      return {
        ok: true,
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
          progress: overallProgress,
          type: project.type,
        },
        tasks: tasks.map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          progress: t.progress,
          depends_on: t.depends_on ? JSON.parse(t.depends_on) : null,
          result: t.result,
          error: t.error,
          agent_id: fromIndexable(t.agent_id),
          attempts: t.attempts ?? 0,
        })),
        summary: {
          total: tasks.length,
          by_status: byStatus,
        },
      };
    } catch (error) {
      return { ok: false, error: `Failed to get project status: ${(error as Error).message}` };
    }
  },
};

// ─── Export all tools ────────────────────────────────────────────────────────

export function createProjectTools(): Tool[] {
  return [projectCreateTool, taskCreateTool, taskCompleteTool, projectStatusTool];
}
