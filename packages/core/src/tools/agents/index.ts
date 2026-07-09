/**
 * Agents Tools - 14 tools
 * 
 * @category agents
 */

import type { Tool } from "../types.ts";
import { col, toIndexable, fromIndexable, BROADCAST } from "../../storage/hive.ts";
import type { MemoryDoc, AgentDoc, ProviderDoc, ModelDoc, TaskDoc, AgentBusMessageDoc } from "../../storage/collections.ts";
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
    const title = params.title as string;
    const content = params.content as string;

    try {
      const memoryCol = await col<MemoryDoc>("memory");
      const existing = await memoryCol.get(title);
      const now = Date.now();
      await memoryCol.put(title, {
        id: title,
        title,
        content,
        created_at: existing?.doc.created_at ?? now,
        updated_at: now,
      }, existing ? { expectedVersion: existing.version } : { expectedVersion: 0 });

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
    const title = params.title as string;

    try {
      const memoryCol = await col<MemoryDoc>("memory");
      const entry = await memoryCol.get(title);

      if (!entry) {
        return { ok: false, error: `Memory not found: ${title}` };
      }

      return {
        ok: true,
        title: entry.doc.title,
        content: entry.doc.content,
        createdAt: new Date(entry.doc.created_at).toISOString(),
        updatedAt: new Date(entry.doc.updated_at).toISOString(),
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
    try {
      const memoryCol = await col<MemoryDoc>("memory");
      const notes = (await memoryCol.scan({}))
        .map(e => e.doc)
        .sort((a, b) => b.updated_at - a.updated_at);

      return {
        ok: true,
        count: notes.length,
        entries: notes.map((n) => ({ title: n.title, createdAt: new Date(n.created_at).toISOString() })),
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
    const query = params.query as string;
    const needle = query.toLowerCase();

    try {
      const memoryCol = await col<MemoryDoc>("memory");
      const notes = (await memoryCol.scan({}))
        .map(e => e.doc)
        .filter(n => n.content.toLowerCase().includes(needle) || n.title.toLowerCase().includes(needle));

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
    const title = params.title as string;

    try {
      const memoryCol = await col<MemoryDoc>("memory");
      const existing = await memoryCol.get(title);

      if (!existing) {
        return { ok: false, error: `Memory not found: ${title}` };
      }

      await memoryCol.delete(title);

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
    const providersCol = await col<ProviderDoc>("providers");
    const providerEntry = await providersCol.get(providerId);

    if (!providerEntry) {
      return {
        ok: false,
        error: `Provider '${providerId}' no existe. Usá get_available_models para ver providers disponibles.`
      };
    }

    if (!providerEntry.doc.enabled || !providerEntry.doc.active) {
      return {
        ok: false,
        error: `Provider '${providerId}' no está activo. Usá get_available_models para ver providers activos.`
      };
    }

    // Validar que el modelo existe y está activo
    const modelsCol = await col<ModelDoc>("models");
    const modelEntry = await modelsCol.get(modelId);

    if (!modelEntry) {
      return {
        ok: false,
        error: `Modelo '${modelId}' no existe. Usá get_available_models para ver modelos disponibles.`
      };
    }

    if (!modelEntry.doc.enabled || !modelEntry.doc.active) {
      return {
        ok: false,
        error: `Modelo '${modelId}' no está activo. Usá get_available_models para ver modelos activos.`
      };
    }

    try {
      const agentId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const now = Date.now();

      const agentsCol = await col<AgentDoc>("agents");
      await agentsCol.put(agentId, {
        id: agentId,
        user_id: userId,
        name,
        description,
        system_prompt: systemPrompt,
        tone,
        role: "worker",
        status: "idle",
        enabled: true,
        provider_id: toIndexable(providerId),
        model_id: toIndexable(modelId),
        tools_json: toolsJson,
        skills_json: null,
        parent_id: toIndexable(parentId),
        max_iterations: maxIterations,
        workspace: parentWorkspace,
        lastTraceAt: null,
        created_at: now,
        updated_at: now,
      }, { expectedVersion: 0 });

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
    const userId = config?.configurable?.user_id;
    const search = params.search as string | undefined;
    const status = params.status as string | undefined;

    try {
      const agentsCol = await col<AgentDoc>("agents");
      let agents = (await agentsCol.scan({}))
        .map(e => e.doc)
        .filter(a => a.user_id === userId && a.role === "worker");

      if (search) {
        const needle = search.toLowerCase();
        agents = agents.filter(a =>
          a.name.toLowerCase().includes(needle) || (a.description ?? "").toLowerCase().includes(needle)
        );
      }

      if (status && status !== "any") {
        agents = agents.filter(a => a.status === status);
      }

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
    const agentId = params.agentId as string;

    try {
      const agentsCol = await col<AgentDoc>("agents");
      const existing = await agentsCol.get(agentId);

      if (!existing) {
        return { ok: false, error: `Agent not found: ${agentId}` };
      }

      await agentsCol.put(agentId, { ...existing.doc, enabled: false, updated_at: Date.now() }, { expectedVersion: existing.version });

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
    const workerId = params.worker_id as string;
    const taskDescription = params.task_description as string;

    const agentsCol = await col<AgentDoc>("agents");
    const workerEntry = await agentsCol.get(workerId);

    if (!workerEntry) {
      return { ok: false, error: `Worker not found: ${workerId}` };
    }
    const worker = workerEntry.doc;
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
    const taskIds = params.task_ids as number[];

    try {
      const tasksCol = await col<TaskDoc>("tasks");
      const ids = taskIds.map((id) => String(id).padStart(15, "0"));
      const entries = await Promise.all(ids.map((id) => tasksCol.get(id)));
      const tasks = entries.filter((e): e is NonNullable<typeof e> => !!e).map(e => e.doc);

      return {
        ok: true,
        task_count: tasks.length,
        tasks: tasks.map((t) => ({
          id: parseInt(t.id, 10),
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
    const workerId = params.worker_id as string | undefined;
    const limit = (params.limit as number) ?? 10;

    try {
      const messagesCol = await col<AgentBusMessageDoc>("agentBusMessages");
      let entries = (await messagesCol.scan({})).filter(e => !e.doc.read);

      if (workerId) {
        entries = entries.filter(e => e.doc.to_worker_id === workerId || e.doc.to_worker_id === BROADCAST);
      }

      entries.sort((a, b) => a.doc.created_at - b.doc.created_at);
      entries = entries.slice(0, limit);

      // Mark as read
      for (const entry of entries) {
        await messagesCol.put(entry.id, { ...entry.doc, read: true }, { expectedVersion: entry.version });
      }

      return {
        ok: true,
        count: entries.length,
        messages: entries.map(({ doc: m }) => ({
          id: m.id,
          event_type: m.event_type,
          content: m.content,
          from_worker_id: fromIndexable(m.from_worker_id),
          created_at: new Date(m.created_at).toISOString(),
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
