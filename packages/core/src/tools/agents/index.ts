/**
 * Agents Tools - 14 tools
 * 
 * @category agents
 */

import type { Tool } from "../types.ts";
import { getDb } from "../../storage/sqlite.ts";
import { logger } from "../../utils/logger.ts";
import { agentBus } from "../../events/agent-bus.ts";

const log = logger.child("agents");

// ─── memory_write ────────────────────────────────────────────────────────────

export const memoryWriteTool: Tool = {
  name: "memory_write",
  description: "Store information in persistent long-term memory. Spanish: guardar memoria, recordar, guardar dato, memoria persistente",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Descriptive title for this memory" },
      content: { type: "string", description: "Content to store" },
    },
    required: ["title", "content"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const title = params.title as string;
    const content = params.content as string;

    try {
      db.query(`
        INSERT OR REPLACE INTO notes (id, title, content, createdAt, updatedAt)
        VALUES (lower(hex(randomblob(16))), ?, ?, unixepoch(), unixepoch())
      `).run(title, content);

      return { ok: true, title, message: "Memory saved." };
    } catch (error) {
      return { ok: false, error: `Failed to save memory: ${(error as Error).message}` };
    }
  },
};

// ─── memory_read ─────────────────────────────────────────────────────────────

export const memoryReadTool: Tool = {
  name: "memory_read",
  description: "Retrieve a memory entry by identifier. Spanish: leer memoria, recuperar dato, obtener memoria",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Title of the memory to retrieve" },
    },
    required: ["title"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const title = params.title as string;

    try {
      const note = db.query<any, [string]>("SELECT * FROM notes WHERE title = ?").get(title);

      if (!note) {
        return { ok: false, error: `Memory not found: ${title}` };
      }

      return {
        ok: true,
        title: note.title,
        content: note.content,
        createdAt: new Date(note.createdAt * 1000).toISOString(),
        updatedAt: new Date(note.updatedAt * 1000).toISOString(),
      };
    } catch (error) {
      return { ok: false, error: `Failed to read memory: ${(error as Error).message}` };
    }
  },
};

// ─── memory_list ─────────────────────────────────────────────────────────────

export const memoryListTool: Tool = {
  name: "memory_list",
  description: "List all saved memory entries. Spanish: listar memorias, ver memorias, todas las memorias",
  parameters: {
    type: "object",
    properties: {},
  },
  execute: async () => {
    const db = getDb();

    try {
      const notes = db.query("SELECT id, title, createdAt FROM notes ORDER BY updatedAt DESC").all() as any[];

      return {
        ok: true,
        count: notes.length,
        entries: notes.map((n) => ({ title: n.title, createdAt: new Date(n.createdAt * 1000).toISOString() })),
      };
    } catch (error) {
      return { ok: false, error: `Failed to list memories: ${(error as Error).message}` };
    }
  },
};

// ─── memory_search ───────────────────────────────────────────────────────────

export const memorySearchTool: Tool = {
  name: "memory_search",
  description: "Search memories by keyword. Spanish: buscar memoria, encontrar recuerdo, buscar dato guardado",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
    },
    required: ["query"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const query = params.query as string;

    try {
      const stmt = db.query<any, [string, string]>(
        "SELECT id, title, content FROM notes WHERE content LIKE ? OR title LIKE ?"
      );
      const notes = stmt.all(`%${query}%`, `%${query}%`) as any[];

      return {
        ok: true,
        query,
        count: notes.length,
        results: notes.map((n) => ({
          title: n.title,
          snippet: n.content.slice(0, 200) + (n.content.length > 200 ? "..." : ""),
        })),
      };
    } catch (error) {
      return { ok: false, error: `Failed to search memories: ${(error as Error).message}` };
    }
  },
};

// ─── memory_delete ───────────────────────────────────────────────────────────

export const memoryDeleteTool: Tool = {
  name: "memory_delete",
  description: "Delete a specific memory entry. Spanish: borrar memoria, eliminar recuerdo, quitar dato",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Title of the memory to delete" },
    },
    required: ["title"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const title = params.title as string;

    try {
      const result = db.query("DELETE FROM notes WHERE title = ?").run(title);

      if (result.changes === 0) {
        return { ok: false, error: `Memory not found: ${title}` };
      }

      return { ok: true, title, message: "Memory deleted." };
    } catch (error) {
      return { ok: false, error: `Failed to delete memory: ${(error as Error).message}` };
    }
  },
};

// ─── agent_create ────────────────────────────────────────────────────────────

export const agentCreateTool: Tool = {
  name: "agent_create",
  description: "Crear un nuevo agente worker especializado. Requiere consultar get_available_models primero para seleccionar provider/model óptimos. Sinónimos: crear agente, nuevo worker, nuevo trabajador",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Nombre del agente" },
      description: { type: "string", description: "Descripción del rol del agente" },
      system_prompt: { type: "string", description: "System prompt para el agente" },
      tools_json: { type: "array", description: "Lista de IDs de herramientas", items: { type: "string" } },
      providerId: { type: "string", description: "ID del provider (openai, anthropic, ollama, etc.) - Obtener de get_available_models" },
      modelId: { type: "string", description: "ID del modelo (gpt-4o, claude-sonnet, etc.) - Obtener de get_available_models" },
      tone: { type: "string", description: "Tono del agente (friendly, professional, direct, etc.)" },
      max_iterations: { type: "number", description: "Límite de iteraciones del agente (default: 10)" },
    },
    required: ["name", "providerId", "modelId"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const db = getDb();
    const userId = config?.configurable?.user_id;
    const parentId = config?.configurable?.agent_id ?? null;
    const name = params.name as string;
    const description = (params.description as string) ?? "";
    const systemPrompt = (params.system_prompt as string) ?? "";
    const toolsJson = params.tools_json ? JSON.stringify(params.tools_json) : null;
    const providerId = params.providerId as string;
    const modelId = params.modelId as string;
    const tone = (params.tone as string) ?? "friendly";
    const maxIterations = (params.max_iterations as number) ?? 10;
    const parentWorkspace = config?.configurable?.workspace ?? null;

    // Validar que providerId y modelId sean obligatorios
    if (!providerId || !modelId) {
      return { 
        ok: false, 
        error: "providerId y modelId son obligatorios. Usá get_available_models para consultar los modelos disponibles antes de crear el agente." 
      };
    }

    // Validar que el provider existe y está activo
    const provider = db.query<any, [string]>(
      "SELECT id, name, enabled, active FROM providers WHERE id = ?"
    ).get(providerId);

    if (!provider) {
      return { 
        ok: false, 
        error: `Provider '${providerId}' no existe. Usá get_available_models para ver providers disponibles.` 
      };
    }

    if (!provider.enabled || !provider.active) {
      return { 
        ok: false, 
        error: `Provider '${providerId}' no está activo. Usá get_available_models para ver providers activos.` 
      };
    }

    // Validar que el modelo existe y está activo
    const model = db.query<any, [string]>(
      "SELECT id, name, enabled, active FROM models WHERE id = ?"
    ).get(modelId);

    if (!model) {
      return { 
        ok: false, 
        error: `Modelo '${modelId}' no existe. Usá get_available_models para ver modelos disponibles.` 
      };
    }

    if (!model.enabled || !model.active) {
      return { 
        ok: false, 
        error: `Modelo '${modelId}' no está activo. Usá get_available_models para ver modelos activos.` 
      };
    }

    try {
      const agentId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

db.query(`
        INSERT INTO agents (id, user_id, name, description, system_prompt, tools_json, role, status, parent_id, provider_id, model_id, tone, max_iterations, workspace)
        VALUES (?, ?, ?, ?, ?, ?, 'worker', 'idle', ?, ?, ?, ?, ?, ?)
      `).run(
        agentId,
        userId,
        name,
        description,
        systemPrompt,
        toolsJson,
        parentId,
        providerId,
        modelId,
        tone,
        maxIterations,
        parentWorkspace
      );

      return { 
        ok: true, 
        agentId, 
        name, 
        providerId, 
        modelId,
        workspace: parentWorkspace,
        message: "Agente creado exitosamente." 
      };
    } catch (error) {
      return { ok: false, error: `Failed to create agent: ${(error as Error).message}` };
    }
  },
};

// ─── agent_find ──────────────────────────────────────────────────────────────

export const agentFindTool: Tool = {
  name: "agent_find",
  description: "Find existing running or idle worker agents. Spanish: buscar agente, encontrar worker, localizar agente",
  parameters: {
    type: "object",
    properties: {
      search: { type: "string", description: "Search term for agent name or description" },
      status: { type: "string", enum: ["idle", "active", "any"], description: "Filter by status" },
    },
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const db = getDb();
    const userId = config?.configurable?.user_id;
    const search = params.search as string | undefined;
    const status = params.status as string | undefined;

    try {
      let query = "SELECT id, name, description, role, status FROM agents WHERE user_id = ? AND role = 'worker'";
      const args: any[] = [userId];

      if (search) {
        query += " AND (name LIKE ? OR description LIKE ?)";
        args.push(`%${search}%`, `%${search}%`);
      }

      if (status && status !== "any") {
        query += " AND status = ?";
        args.push(status);
      }

      const agents = db.query(query).all(...args) as any[];

      return {
        ok: true,
        count: agents.length,
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          role: a.role,
          status: a.status,
        })),
      };
    } catch (error) {
      return { ok: false, error: `Failed to find agents: ${(error as Error).message}` };
    }
  },
};

// ─── agent_archive ───────────────────────────────────────────────────────────

export const agentArchiveTool: Tool = {
  name: "agent_archive",
  description: "Archive or terminate a worker agent. Spanish: archivar agente, terminar worker, desactivar agente",
  parameters: {
    type: "object",
    properties: {
      agentId: { type: "string", description: "ID of the agent to archive" },
    },
    required: ["agentId"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const agentId = params.agentId as string;

    try {
      const result = db.query(`UPDATE agents SET enabled = 0, updated_at = unixepoch() WHERE id = ?`).run(agentId);

      if (result.changes === 0) {
        return { ok: false, error: `Agent not found: ${agentId}` };
      }

      return { ok: true, agentId, message: "Agent archived." };
    } catch (error) {
      return { ok: false, error: `Failed to archive agent: ${(error as Error).message}` };
    }
  },
};

// ─── task_delegate ───────────────────────────────────────────────────────────

export const taskDelegateTool: Tool = {
  name: "task_delegate",
  description: "Delegate a task to a worker agent and execute it immediately (blocking). Spanish: delegar tarea, asignar worker, ejecutar por agente, delegate_task",
  parameters: {
    type: "object",
    properties: {
      worker_id: { type: "string", description: "ID of the worker agent" },
      task_description: { type: "string", description: "Clear, detailed instructions for the worker" },
    },
    required: ["worker_id", "task_description"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const db = getDb();
    const workerId = params.worker_id as string;
    const taskDescription = params.task_description as string;

    const worker = db.query<any, [string]>(
      "SELECT id, name, enabled FROM agents WHERE id = ?"
    ).get(workerId);

    if (!worker) {
      return { ok: false, error: `Worker not found: ${workerId}` };
    }
    if (!worker.enabled) {
      return { ok: false, error: `Worker is disabled: ${worker.name}` };
    }

    const taskName = taskDescription.slice(0, 60);
    agentBus.notifyTaskStarted(workerId, worker.name, 0, taskName, "");

    log.info(`[task_delegate] Delegating to ${worker.name} (${workerId})`);

    try {
      const { runAgentIsolated } = await import("../../agent/agent-loop.ts");

      const threadId = `task-${Date.now()}-${workerId}`;
      const result = await runAgentIsolated({
        agentId: workerId,
        taskDescription,
        threadId,
      });

      agentBus.notifyTaskCompleted(workerId, worker.name, 0, taskName, "", result);

      return {
        ok: true,
        worker_id: workerId,
        worker_name: worker.name,
        result,
      };
    } catch (err) {
      agentBus.notifyTaskFailed(workerId, worker.name, 0, taskName, "", (err as Error).message);

      return {
        ok: false,
        worker_id: workerId,
        error: (err as Error).message,
      };
    }
  },
};

// ─── task_delegate_code ──────────────────────────────────────────────────────

export const taskDelegateCodeTool: Tool = {
  name: "task_delegate_code",
  description: "Delegate a coding task to a CLI subagent (Qwen, Claude, etc.) via Code Bridge. Spanish: delegar código, subagente CLI, programación, Qwen",
  parameters: {
    type: "object",
    properties: {
      cli: { type: "string", enum: ["qwen", "claude", "opencode", "gemini"], description: "CLI tool to use" },
      task_instructions: { type: "string", description: "Coding task instructions" },
    },
    required: ["cli", "task_instructions"],
  },
  execute: async (params: Record<string, unknown>) => {
    const cli = params.cli as string;
    const taskInstructions = params.task_instructions as string;

    return {
      ok: true,
      cli,
      message: `Code task delegated to ${cli}: ${taskInstructions.substring(0, 100)}...`,
    };
  },
};

// ─── task_status ─────────────────────────────────────────────────────────────

export const taskStatusTool: Tool = {
  name: "task_status",
  description: "Get execution status of one or more delegated tasks. Spanish: estado tarea delegada, verificar progreso, consultar tarea",
  parameters: {
    type: "object",
    properties: {
      task_ids: { type: "array", description: "List of task IDs", items: { type: "number" } },
    },
    required: ["task_ids"],
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const taskIds = params.task_ids as number[];

    try {
      const placeholders = taskIds.map(() => "?").join(",");
      const tasks = db.query<any, any[]>(
        `SELECT id, name, status, progress, result FROM tasks WHERE id IN (${placeholders})`
      ).all(...taskIds) as any[];

      return {
        ok: true,
        task_count: tasks.length,
        tasks: tasks.map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          progress: t.progress,
          result: t.result,
        })),
      };
    } catch (error) {
      return { ok: false, error: `Failed to get task status: ${(error as Error).message}` };
    }
  },
};

// ─── bus_publish ─────────────────────────────────────────────────────────────

export const busPublishTool: Tool = {
  name: "bus_publish",
  description: "Publish a message to the Agent Bus for worker-to-worker communication. Spanish: publicar mensaje, comunicar workers, enviar bus",
  parameters: {
    type: "object",
    properties: {
      event_type: { type: "string", description: "Type of event" },
      content: { type: "string", description: "Message content" },
      to_worker_id: { type: "string", description: "Target worker ID (optional)" },
    },
    required: ["event_type", "content"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const eventType = params.event_type as string;
    const content = params.content as string;
    const toWorkerId = (params.to_worker_id as string) ?? undefined;
    const fromWorkerId = config?.configurable?.agent_id ?? "unknown";

    try {
      agentBus.publish("message:custom", {
        fromWorkerId,
        fromWorkerName: fromWorkerId,
        toWorkerId,
        topic: eventType,
        content,
        timestamp: Date.now(),
      });

      return { ok: true, message: "Message published." };
    } catch (error) {
      return { ok: false, error: `Failed to publish: ${(error as Error).message}` };
    }
  },
};

// ─── bus_read ────────────────────────────────────────────────────────────────

export const busReadTool: Tool = {
  name: "bus_read",
  description: "Read unread messages from the Agent Bus. Spanish: leer mensajes bus, recibir mensajes, verificar bus",
  parameters: {
    type: "object",
    properties: {
      worker_id: { type: "string", description: "Filter by target worker ID" },
      limit: { type: "number", description: "Maximum messages to return (default: 10)" },
    },
  },
  execute: async (params: Record<string, unknown>) => {
    const db = getDb();
    const workerId = params.worker_id as string | undefined;
    const limit = (params.limit as number) ?? 10;

    try {
      let query = "SELECT * FROM agent_bus_messages WHERE read = 0";
      const args: any[] = [];

      if (workerId) {
        query += " AND (to_worker_id = ? OR to_worker_id IS NULL)";
        args.push(workerId);
      }

      query += " ORDER BY created_at ASC LIMIT ?";
      args.push(limit);

      const messages = db.query(query).all(...args) as any[];

      // Mark as read
      if (messages.length > 0) {
        const ids = messages.map((m) => m.id).join(",");
        db.query(`UPDATE agent_bus_messages SET read = 1 WHERE id IN (${ids})`).run();
      }

      return {
        ok: true,
        count: messages.length,
        messages: messages.map((m) => ({
          id: m.id,
          event_type: m.event_type,
          content: m.content,
          from_worker_id: m.from_worker_id,
          created_at: new Date(m.created_at * 1000).toISOString(),
        })),
      };
    } catch (error) {
      return { ok: false, error: `Failed to read messages: ${(error as Error).message}` };
    }
  },
};


import crypto from "crypto";
import { getAvailableModelsTool } from "./get-available-models.ts";

export function createTools(): Tool[] {
  return [
    memoryWriteTool,
    memoryReadTool,
    memoryListTool,
    memorySearchTool,
    memoryDeleteTool,
    getAvailableModelsTool,
    agentCreateTool,
    agentFindTool,
    agentArchiveTool,
    taskDelegateTool,
    taskDelegateCodeTool,
    taskStatusTool,
    busPublishTool,
    busReadTool,
  ];
}
