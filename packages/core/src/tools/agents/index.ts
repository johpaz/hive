/**
 * Agents Tools - 15 tools
 *
 * @category agents
 */

import type { Tool } from "../types.ts";
import { col, toIndexable, fromIndexable, BROADCAST } from "../../storage/hive.ts";
import type { MemoryDoc, AgentDoc, ProviderDoc, ModelDoc, McpServerDoc, TaskDoc, AgentBusMessageDoc, AgentAcceptanceCriterion } from "../../storage/collections.ts";
import type { AcceptanceCriterion } from "../../agent/run-store.ts";
import type { PreparedDelegation } from "../../agent/delegation-runtime.ts";
import { logger } from "../../utils/logger.ts";
import { agentBus } from "../../events/agent-bus.ts";
import {
  emitDelegationStarted,
  emitDelegationFinished,
  emitWorkEvent,
} from "../../canvas/emitter.ts";

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
  description: "Crear un nuevo agente worker especializado. Requiere consultar get_available_models; para un especialista MCP confirmado por el usuario, acepta mcp_server_id. Sinónimos: crear agente, nuevo worker, nuevo trabajador",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Nombre del agente" },
      description: { type: "string", description: "Descripción del rol del agente" },
      system_prompt: { type: "string", description: "System prompt para el agente" },
      tools_json: { type: "array", description: "Lista de IDs de herramientas", items: { type: "string" } },
      providerId: { type: "string", description: "ID del provider (openai, anthropic, ollama, etc.) - Obtener de get_available_models" },
      modelId: { type: "string", description: "ID del modelo (gpt-4o, claude-sonnet, etc.) - Obtener de get_available_models" },
      mcp_server_id: {
        type: "string",
        description: "Servidor MCP persistente para un especialista. Requiere confirmación previa del usuario y asigna todas las tools actuales y futuras de ese servidor.",
      },
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
    const mcpServerId = params.mcp_server_id as string | undefined;
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

    // Validar que el modelo existe y pertenece al provider ya validado. `active` en un
    // ModelDoc solo marca el modelo por defecto del usuario (elegido en onboarding), no
    // si el modelo es utilizable — cualquier modelo del provider configurado sirve.
    const modelsCol = await col<ModelDoc>("models");
    const modelEntry = await modelsCol.get(modelId);

    if (!modelEntry) {
      return {
        ok: false,
        error: `Modelo '${modelId}' no existe. Usá get_available_models para ver modelos disponibles.`
      };
    }

    if (!modelEntry.doc.enabled) {
      return {
        ok: false,
        error: `Modelo '${modelId}' no está habilitado. Usá get_available_models para ver modelos disponibles.`
      };
    }

    if (modelEntry.doc.provider_id !== providerId) {
      return {
        ok: false,
        error: `Modelo '${modelId}' pertenece al provider '${modelEntry.doc.provider_id}', no a '${providerId}'.`
      };
    }

    if (mcpServerId) {
      if (!userId) {
        return { ok: false, error: "No se puede asignar un servidor MCP sin contexto de usuario." };
      }
      const serverEntry = await (await col<McpServerDoc>("mcpServers")).get(mcpServerId);
      if (!serverEntry?.doc.enabled) {
        return { ok: false, error: `El servidor MCP '${mcpServerId}' no existe o está deshabilitado.` };
      }
      if (serverEntry.doc.user_id && serverEntry.doc.user_id !== userId) {
        return { ok: false, error: `El servidor MCP '${mcpServerId}' pertenece a otro usuario.` };
      }

      const existingSpecialist = (await (await col<AgentDoc>("agents")).scan({}))
        .map((entry) => entry.doc)
        .find((agent) => {
          if (agent.role !== "worker" || agent.user_id !== userId) return false;
          try {
            return agent.mcp_server_ids_json
              ? (JSON.parse(agent.mcp_server_ids_json) as string[]).includes(mcpServerId)
              : false;
          } catch {
            return false;
          }
        });
      if (existingSpecialist) {
        const action = existingSpecialist.enabled
          ? "Reutilizalo con task_delegate."
          : "Está deshabilitado; el usuario debe reactivarlo desde Agentes.";
        return {
          ok: false,
          existingAgentId: existingSpecialist.id,
          error: `Ya existe el especialista '${existingSpecialist.name}' para ese servidor. ${action}`,
        };
      }
    }

    try {
      const agentId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const now = Date.now();

      const agentsCol = await col<AgentDoc>("agents");
      await agentsCol.put(agentId, {
        id: agentId,
        user_id: userId ?? "",
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
        active_mcp_json: null,
        parent_id: toIndexable(parentId),
        max_iterations: maxIterations,
        workspace: parentWorkspace,
        lastTraceAt: null,
        created_at: now,
        updated_at: now,
        source: "user",
        mcp_server_ids_json: mcpServerId ? JSON.stringify([mcpServerId]) : null,
      }, { expectedVersion: 0 });

      return {
        ok: true,
        agentId,
        name,
        providerId,
        modelId,
        mcpServerId: mcpServerId ?? null,
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
  description: "Discover available worker agents. Includes global system catalog agents plus private workers owned by the current user. This tool does not report task execution; use task_list/task_status for that. Spanish: buscar agente, encontrar worker, localizar agente",
  parameters: {
    type: "object",
    properties: {
      search: { type: "string", description: "Search term for agent name or description" },
      availability: { type: "string", enum: ["enabled", "disabled", "any"], description: "Filter by whether the worker can accept tasks" },
      status: { type: "string", enum: ["idle", "active", "any"], description: "Deprecated compatibility alias. It does not represent task execution; use task_list." },
    },
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const userId = config?.configurable?.user_id;
    const search = params.search as string | undefined;
    const legacyStatus = params.status as string | undefined;
    const availability = (params.availability as string | undefined)
      ?? (legacyStatus === "any" ? "any" : legacyStatus ? "enabled" : "any");

    try {
      const agentsCol = await col<AgentDoc>("agents");
      const mcpServersCol = await col<McpServerDoc>("mcpServers");
      const serverNames = new Map(
        (await mcpServersCol.scan({})).map((entry) => [entry.doc.id, entry.doc.name]),
      );
      let agents = (await agentsCol.scan({}))
        .map(e => e.doc)
        .filter(a =>
          a.role === "worker"
          && (a.source === "catalog" || (!!userId && a.user_id === userId))
        );

      if (search) {
        const needle = search.toLowerCase();
        agents = agents.filter((a) => {
          let assignedServerIds: string[] = [];
          try {
            assignedServerIds = a.mcp_server_ids_json ? JSON.parse(a.mcp_server_ids_json) : [];
          } catch {
            assignedServerIds = [];
          }
          return a.name.toLowerCase().includes(needle)
            || (a.description ?? "").toLowerCase().includes(needle)
            || assignedServerIds.some((id) =>
              id.toLowerCase().includes(needle)
              || (serverNames.get(id) ?? "").toLowerCase().includes(needle),
            );
        });
      }

      if (availability !== "any") {
        agents = agents.filter(a => availability === "enabled" ? a.enabled : !a.enabled);
      }

      return {
        ok: true,
        count: agents.length,
        execution_source: "Use task_list or task_status for real execution state.",
        ...(legacyStatus ? { warning: "The status filter is deprecated and cannot prove whether a task is running." } : {}),
        agents: agents.map((a) => {
          let mcpServerIds: string[] = [];
          try {
            mcpServerIds = a.mcp_server_ids_json ? JSON.parse(a.mcp_server_ids_json) : [];
          } catch {
            mcpServerIds = [];
          }
          return {
            id: a.id,
            name: a.name,
            description: a.description,
            role: a.role,
            source: a.source ?? "user",
            enabled: a.enabled,
            availability: a.enabled ? "enabled" : "disabled",
            mcpServerIds,
            mcpServers: mcpServerIds.map((id) => ({ id, name: serverNames.get(id) ?? id })),
          };
        }),
      };
    } catch (error) {
      return { ok: false, error: `Failed to find agents: ${(error as Error).message}` };
    }
  },
};

// ─── agent_archive ───────────────────────────────────────────────────────────

export const agentArchiveTool: Tool = {
  name: "agent_archive",
  description: "Archive or terminate a worker you created. Catalog agents cannot be archived — only the user can disable those from the UI. Spanish: archivar agente, terminar worker",
  parameters: {
    type: "object",
    properties: {
      agentId: { type: "string", description: "ID of the worker to archive (not a catalog agent)" },
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

      // Catalog personas are shared capabilities of the whole hive — turning
      // one off is the user's call, from the UI, never an agent's.
      if (existing.doc.source === "catalog") {
        return {
          ok: false,
          error: `'${existing.doc.name}' is a catalog agent and stays available. Only the user can disable it from the Agents UI.`,
        };
      }

      await agentsCol.put(agentId, { ...existing.doc, enabled: false, status: "archived", updated_at: Date.now() }, { expectedVersion: existing.version });

      return { ok: true, agentId, message: "Agent archived." };
    } catch (error) {
      return { ok: false, error: `Failed to archive agent: ${(error as Error).message}` };
    }
  },
};

// ─── task_delegate ───────────────────────────────────────────────────────────

export const taskDelegateTool: Tool = {
  name: "task_delegate",
  description: "Delegate a bounded task to an existing worker_id (any `agents` row: catalog-seeded or agent_create-made). The delivery goes through deterministic acceptance checks (no LLM); you judge anything they don't cover in your closing turn, and use task_revise to send it back with feedback if it doesn't meet its criteria. mode=sync blocks the conversation until done; mode=async enqueues and frees the conversation immediately — the user is notified automatically in this same chat when the worker finishes. Prefer async unless you expect the result in a few seconds.",
  parameters: {
    type: "object",
    properties: {
      worker_id: { type: "string", description: "Target agent ID — from agent_find or the catalog agent list in the system prompt." },
      task_description: { type: "string", description: "Clear, detailed instructions for the worker" },
      acceptance: {
        type: "array",
        description: "Verifiable acceptance criteria. The worker's default criteria are used when omitted.",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            description: { type: "string" },
            checkTool: { type: "string" },
          },
          required: ["id", "description"],
        },
      },
      mode: { type: "string", enum: ["sync", "async"], description: "sync (default, blocking, 2min timeout — only for very short delegations) or async (enqueued, frees the conversation instantly; outcome is relayed back to the user automatically). Prefer async for anything non-trivial." },
    },
    required: ["task_description"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const agentId = params.worker_id as string | undefined;
    const taskDescription = params.task_description as string;
    const mode = (params.mode as string) ?? "sync";
    const turnId = config?.configurable?.turn_id as string | undefined;

    if (!agentId) return { ok: false, error: "Provide worker_id." };

    const agentsCol = await col<AgentDoc>("agents");
    const parentAgentId = config?.configurable?.agent_id ?? "";
    if (!parentAgentId) {
      return { ok: false, error: "Delegation caller identity is missing (config.configurable.agent_id). The coordinator may exist, but its ID was not propagated to task_delegate." };
    }
    const parentEntry = await agentsCol.get(parentAgentId);
    if (!parentEntry) return { ok: false, error: `Delegation caller agent not found: ${parentAgentId}` };
    if (!parentEntry.doc.enabled) return { ok: false, error: `Delegation caller agent is disabled: ${parentAgentId}` };
    const parent = parentEntry.doc;
    const parentProviderId = fromIndexable(parent.provider_id);
    const parentModelId = fromIndexable(parent.model_id);

    const workerEntry = await agentsCol.get(agentId);
    if (!workerEntry) return { ok: false, error: `Agent not found: ${agentId}` };
    const worker = workerEntry.doc;
    if (!worker.enabled) return { ok: false, error: `Agent is disabled: ${worker.name}` };

    const taskName = taskDescription.slice(0, 60);
    const defaultAcceptance: AgentAcceptanceCriterion[] | null = worker.default_acceptance_json
      ? JSON.parse(worker.default_acceptance_json)
      : null;
    const acceptance = ((params.acceptance as AcceptanceCriterion[] | undefined)
      ?? defaultAcceptance?.map((criterion) => ({
        id: criterion.id,
        description: criterion.description,
        checkTool: criterion.check_tool,
      }))
      ?? [{ id: "objective", description: taskDescription }]);

    // ── Async mode: create TaskDoc + enqueue worker_task in durable queue ──
    if (mode === "async") {
      try {
        const { nextId, toIndexable, updateDoc } = await import("../../storage/hive.ts");
        const { createRun } = await import("../../agent/run-store.ts");
        const { getDurableQueue } = await import("../../gateway/durable-queue.ts");

        const taskId = await nextId("tasks");
        const now = Date.now();
        const tasksCol = await col<TaskDoc>("tasks");
        await tasksCol.put(taskId, {
          id: taskId,
          agent_id: toIndexable(agentId),
          name: taskName,
          description: taskDescription,
          status: "pending",
          progress: 0,
          result: null,
          error: null,
          metadata: null,
          job_id: null,
          run_id: null,
          thread_id: null,
          delegation_group_id: turnId ?? null,
          catalog_agent_id: toIndexable(worker.source === "catalog" ? agentId : null),
          started_at: null,
          attempts: 0,
          created_at: now,
          updated_at: now,
          completed_at: null,
        }, { expectedVersion: 0 });

        if (turnId) {
          const { registerDelegatedTask } = await import("../../gateway/delegation-groups.ts");
          await registerDelegatedTask({
            turnId,
            taskId,
            threadId: config?.configurable?.thread_id ?? "",
            channel: config?.configurable?.channel,
            userId: config?.configurable?.user_id,
            sessionId: config?.configurable?.session_id,
            coordinatorAgentId: parentAgentId,
          });
        }

        const run = await createRun({
          thread_id: `task-${taskId}-${agentId}`,
          agent_id: agentId,
          user_id: config?.configurable?.user_id ?? "",
          channel: config?.configurable?.channel ?? null,
          kind: "worker",
          max_iterations: worker.max_iterations || 10,
          resume_policy: "resume",
          acceptance,
          catalog_agent_id: worker.source === "catalog" ? agentId : undefined,
        });

        const queue = getDurableQueue();
        const job = await queue.enqueue({
          lane: `task:${taskId}`,
          type: "worker_task",
          run_id: run.id,
          payload: {
            workerId: agentId,
            taskDescription,
            taskName,
            taskId,
            acceptance,
            parentAgentId,
            parentProviderId,
            parentModelId,
            userId: config?.configurable?.user_id ?? "",
            workspace: config?.configurable?.workspace ?? null,
            // Delegating conversation's thread — lets delegation-notify.ts relay
            // the outcome back to the user once this job reaches a terminal state.
            originThreadId: config?.configurable?.thread_id ?? null,
            originChannel: config?.configurable?.channel ?? null,
            originSessionId: config?.configurable?.session_id ?? null,
            turnId: turnId ?? null,
          },
        });

        await updateDoc<TaskDoc>("tasks", taskId, {
          job_id: job.id,
          run_id: run.id,
          thread_id: `task-${taskId}-${agentId}`,
          updated_at: Date.now(),
        } as Partial<TaskDoc>);

        agentBus.notifyTaskStarted(agentId, worker.name, 0, taskName, "");
        if (turnId) {
          const { publishNarration } = await import("../../events/narration.ts");
          await publishNarration({
            turnId,
            threadId: config?.configurable?.thread_id ?? "",
            channel: config?.configurable?.channel,
            userId: config?.configurable?.user_id,
            sessionId: config?.configurable?.session_id,
            agentId,
            agentName: worker.name,
            kind: "delegated",
            status: "queued",
            label: `Delegué “${taskName}” a ${worker.name}`,
            dedupeKey: `delegated:${taskId}`,
          });
        }

        return {
          ok: true,
          task_id: taskId,
          job_id: job.id,
          run_id: run.id,
          worker_id: agentId,
          worker_name: worker.name,
          status: "queued",
          message: `Task enqueued (async). Use task_list for the queue or task_status with task_id="${taskId}" for this task.`,
        };
      } catch (err) {
        return { ok: false, error: `Async delegation failed: ${(err as Error).message}` };
      }
    }

    // ── Sync mode: blocking execution with 2min timeout ──
    const { prepareDelegation } = await import("../../agent/delegation-runtime.ts");
    const { getMCPManager } = await import("../../mcp/singleton.ts");
    const mcpManager = getMCPManager();

    let prepared: PreparedDelegation;
    try {
      prepared = await prepareDelegation(agentId, {
        workspace: config?.configurable?.workspace ?? null,
        parentProviderId,
        parentModelId,
        mcpManager,
      });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    agentBus.notifyTaskStarted(agentId, worker.name, 0, taskName, "");
    log.info(`[task_delegate] Delegating (sync) to ${worker.name} (${agentId})`);
    const syncDelegationRef = `sync-${Date.now()}-${agentId}`;
    emitDelegationStarted({ workerId: agentId, parentAgentId, taskRef: syncDelegationRef, taskName });

    try {
      const { runAgentIsolated, withTimeout } = await import("../../agent/agent-loop.ts");

      const threadId = `task-${Date.now()}-${agentId}`;
      const SYNC_TIMEOUT_MS = 2 * 60 * 1000;

      // Real cancellation (e.g. the user's "stop" button): the job's AbortSignal
      // reaches us via config.signal (tool-runtime/index.ts's executeToolBatch),
      // and runAgentIsolated/runAgent already honor it mid-run. withTimeout stays
      // as a hard ceiling in case the signal path doesn't stop things in time.
      const signal = config?.signal as AbortSignal | undefined;
      const result = await withTimeout(
        () => runAgentIsolated({
          agentId,
          taskDescription,
          threadId,
          mcpManager,
          signal,
        }),
        SYNC_TIMEOUT_MS,
      );

      agentBus.notifyTaskCompleted(agentId, worker.name, 0, taskName, "", result);

      // Deterministic acceptance checks now always run, closing the old gap
      // where a plain worker_id delegation (agent_create) skipped them
      // entirely in sync mode. No LLM call: the calling agent (usually the
      // coordinator) judges the delivery itself in this same tool response.
      const { runAcceptanceChecks, recordAgentOutcome } = await import("../../agent/acceptance-checks.ts");
      const checks = await runAcceptanceChecks({
        objective: taskDescription,
        acceptance,
        delivery: result,
        evidence: [result],
      });
      if (checks.status === "failed") {
        await recordAgentOutcome(agentId, "harmful");
        emitWorkEvent({
          phase: "review_failed",
          taskRef: syncDelegationRef,
          taskName,
          actorId: parentAgentId || agentId,
          targetId: agentId,
          detail: checks.summary,
        });
        return {
          ok: false,
          status: checks.status,
          error: checks.summary,
        };
      }
      await recordAgentOutcome(agentId, "helpful");
      emitWorkEvent({
        phase: "review_passed",
        taskRef: syncDelegationRef,
        taskName,
        actorId: parentAgentId || agentId,
        targetId: agentId,
      });
      emitWorkEvent({
        phase: "completed",
        taskRef: syncDelegationRef,
        taskName,
        actorId: agentId,
        targetId: parentAgentId || null,
      });
      return {
        ok: true,
        worker_id: agentId,
        worker_name: worker.name,
        acceptance,
        checks,
        result,
      };
    } catch (err) {
      const errorMessage = (err as Error).message;
      const wasAborted = (config?.signal as AbortSignal | undefined)?.aborted === true;
      agentBus.notifyTaskFailed(agentId, worker.name, 0, taskName, "", errorMessage);
      emitWorkEvent({
        phase: wasAborted ? "aborted" : "failed",
        taskRef: syncDelegationRef,
        taskName,
        actorId: agentId,
        targetId: parentAgentId || null,
        detail: wasAborted ? "Trabajo interrumpido" : errorMessage,
      });

      return {
        ok: false,
        worker_id: agentId,
        error: errorMessage,
      };
    } finally {
      emitDelegationFinished({ workerId: agentId, taskRef: syncDelegationRef });
      await prepared.release();
    }
  },
};

// ─── task_revise ─────────────────────────────────────────────────────────────

const MAX_TASK_REVISIONS = 2;

export const taskReviseTool: Tool = {
  name: "task_revise",
  description: "Send a completed or blocked delegated task back to its worker with concrete feedback, instead of reporting it as done. The worker resumes on the SAME thread — it keeps its prior context, so the feedback only needs to describe what's missing. Use this when a delivery doesn't meet its acceptance criteria and you can't fix it yourself.",
  parameters: {
    type: "object",
    properties: {
      task_id: { type: "string", description: "The task_id from task_delegate's result." },
      feedback: { type: "string", description: "Concrete, actionable feedback: what's wrong and what the worker still needs to do." },
      acceptance: {
        type: "array",
        description: "Updated acceptance criteria, if they need to change. Defaults to the original task's criteria.",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            description: { type: "string" },
            checkTool: { type: "string" },
          },
          required: ["id", "description"],
        },
      },
    },
    required: ["task_id", "feedback"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const taskId = params.task_id as string | undefined;
    const feedback = params.feedback as string | undefined;
    if (!taskId) return { ok: false, error: "Provide task_id." };
    if (!feedback || !feedback.trim()) return { ok: false, error: "Provide feedback describing what's missing." };

    const parentAgentId = config?.configurable?.agent_id ?? "";
    if (!parentAgentId) {
      return { ok: false, error: "Caller identity is missing (config.configurable.agent_id)." };
    }
    const agentsCol = await col<AgentDoc>("agents");
    const parentEntry = await agentsCol.get(parentAgentId);
    if (!parentEntry) return { ok: false, error: `Caller agent not found: ${parentAgentId}` };
    const parentProviderId = fromIndexable(parentEntry.doc.provider_id);
    const parentModelId = fromIndexable(parentEntry.doc.model_id);

    const tasksCol = await col<TaskDoc>("tasks");
    const taskEntry = await tasksCol.get(taskId);
    if (!taskEntry) return { ok: false, error: `Task not found: ${taskId}` };
    const task = taskEntry.doc;
    if (task.status !== "completed" && task.status !== "blocked") {
      return { ok: false, error: `Task ${taskId} is "${task.status}" — only completed or blocked tasks can be revised.` };
    }
    if ((task.attempts ?? 0) >= MAX_TASK_REVISIONS) {
      return { ok: false, error: `Task ${taskId} already used its ${MAX_TASK_REVISIONS} revision attempt(s). Fix it yourself or report the limit to the user.` };
    }
    if (!task.thread_id) {
      return { ok: false, error: `Task ${taskId} has no thread_id — cannot resume its worker.` };
    }

    const agentId = fromIndexable(task.agent_id);
    const workerEntry = agentId ? await agentsCol.get(agentId) : null;
    if (!workerEntry) return { ok: false, error: `Worker not found for task ${taskId}: ${agentId}` };
    const worker = workerEntry.doc;
    if (!worker.enabled) return { ok: false, error: `Worker is disabled: ${worker.name}` };

    const { createRun, getRun, deserializeAcceptance } = await import("../../agent/run-store.ts");
    const { getDurableQueue } = await import("../../gateway/durable-queue.ts");
    const { updateDoc } = await import("../../storage/hive.ts");

    const previousRun = task.run_id ? await getRun(task.run_id) : null;
    const previousAcceptance = previousRun ? deserializeAcceptance(previousRun) : null;
    const acceptance = (params.acceptance as AcceptanceCriterion[] | undefined) ?? previousAcceptance ?? [{ id: "objective", description: task.description ?? feedback }];

    try {
      const run = await createRun({
        thread_id: task.thread_id,
        agent_id: agentId!,
        user_id: config?.configurable?.user_id ?? "",
        channel: config?.configurable?.channel ?? null,
        kind: "worker",
        max_iterations: worker.max_iterations || 10,
        resume_policy: "resume",
        acceptance,
        catalog_agent_id: worker.source === "catalog" ? agentId! : undefined,
      });

      const turnId = config?.configurable?.turn_id as string | undefined;
      if (turnId) {
        const { registerDelegatedTask } = await import("../../gateway/delegation-groups.ts");
        await registerDelegatedTask({
          turnId,
          taskId,
          threadId: config?.configurable?.thread_id ?? "",
          channel: config?.configurable?.channel,
          userId: config?.configurable?.user_id,
          sessionId: config?.configurable?.session_id,
          coordinatorAgentId: parentAgentId,
        });
      }

      const queue = getDurableQueue();
      const job = await queue.enqueue({
        lane: `task:${taskId}`,
        type: "worker_task",
        run_id: run.id,
        payload: {
          workerId: agentId,
          taskDescription: `${task.description ?? ""}\n\nCORRECCIÓN SOLICITADA: ${feedback}`,
          taskName: task.name,
          taskId,
          acceptance,
          parentAgentId,
          parentProviderId,
          parentModelId,
          userId: config?.configurable?.user_id ?? "",
          workspace: config?.configurable?.workspace ?? null,
          originThreadId: config?.configurable?.thread_id ?? null,
          originChannel: config?.configurable?.channel ?? null,
          originSessionId: config?.configurable?.session_id ?? null,
          turnId: turnId ?? null,
          revision: true,
        },
      });

      await updateDoc<TaskDoc>("tasks", taskId, {
        status: "pending",
        error: null,
        job_id: job.id,
        run_id: run.id,
        attempts: (task.attempts ?? 0) + 1,
        delegation_group_id: turnId ?? task.delegation_group_id ?? null,
        updated_at: Date.now(),
      } as Partial<TaskDoc>);

      const { recordAgentOutcome } = await import("../../agent/acceptance-checks.ts");
      await recordAgentOutcome(agentId, "harmful");

      emitWorkEvent({
        phase: "review_failed",
        taskRef: taskId,
        taskName: task.name,
        actorId: parentAgentId,
        targetId: agentId!,
        detail: feedback,
      });

      if (turnId) {
        const { publishNarration } = await import("../../events/narration.ts");
        await publishNarration({
          turnId,
          threadId: config?.configurable?.thread_id ?? "",
          channel: config?.configurable?.channel,
          userId: config?.configurable?.user_id,
          sessionId: config?.configurable?.session_id,
          agentId: agentId!,
          agentName: worker.name,
          kind: "delegated",
          status: "queued",
          label: `Devolví “${task.name}” a ${worker.name} con correcciones`,
          dedupeKey: `revised:${taskId}:${(task.attempts ?? 0) + 1}`,
        });
      }

      return {
        ok: true,
        task_id: taskId,
        job_id: job.id,
        run_id: run.id,
        worker_id: agentId,
        attempts: (task.attempts ?? 0) + 1,
        status: "queued",
        message: `Revision enqueued (async). Use task_status with task_id="${taskId}" to check it.`,
      };
    } catch (err) {
      return { ok: false, error: `Task revision failed: ${(err as Error).message}` };
    }
  },
};

// ─── task_list ──────────────────────────────────────────────────────────────

export const taskListTool: Tool = {
  name: "task_list",
  description: "List real delegated task executions for the current user. TaskDoc and JobDoc are the source of truth. Use this instead of agent_find to determine whether work is pending, running, completed, failed, or blocked.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["pending", "running", "completed", "failed", "blocked", "all"],
        description: "Execution-state filter (default: all)",
      },
      worker_id: { type: "string", description: "Optional worker agent ID" },
      limit: { type: "number", description: "Maximum tasks to return (default 20, maximum 100)" },
    },
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    const userId = config?.configurable?.user_id as string | undefined;
    if (!userId) return { ok: false, error: "Missing user context for task_list." };

    const status = (params.status as string | undefined) ?? "all";
    const workerId = params.worker_id as string | undefined;
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 20));

    try {
      const tasksCol = await col<TaskDoc>("tasks");
      const runsCol = await col<import("../../storage/collections.ts").AgentRunDoc>("agentRuns");
      const { getJob } = await import("../../gateway/job-store.ts");
      const allTasks = (await tasksCol.scan({}))
        .map((entry) => entry.doc)
        .sort((a, b) => b.updated_at - a.updated_at);

      const result: Array<Record<string, unknown>> = [];
      for (const task of allTasks) {
        if (result.length >= limit) break;
        if (workerId && fromIndexable(task.agent_id) !== workerId) continue;

        const run = task.run_id ? await runsCol.get(task.run_id) : null;
        if (!run || run.doc.user_id !== userId) continue;

        const job = task.job_id ? await getJob(task.job_id) : null;
        const executionState =
          task.status === "pending"
            ? "pending"
            : task.status === "in_progress"
              ? "running"
              : task.status;
        if (status !== "all" && executionState !== status) continue;

        result.push({
          id: task.id,
          name: task.name,
          description: task.description,
          worker_id: fromIndexable(task.agent_id),
          status: task.status,
          execution_state: executionState,
          progress: task.progress,
          result: task.result,
          error: task.error,
          job_id: task.job_id,
          job_status: job?.status ?? null,
          run_id: task.run_id,
          run_status: run.doc.status,
          attempts: task.attempts ?? 0,
          created_at: task.created_at,
          started_at: task.started_at,
          updated_at: task.updated_at,
          completed_at: task.completed_at,
        });
      }

      return { ok: true, task_count: result.length, tasks: result };
    } catch (error) {
      return { ok: false, error: `Failed to list delegated tasks: ${(error as Error).message}` };
    }
  },
};

// ─── task_status ─────────────────────────────────────────────────────────────

export const taskStatusTool: Tool = {
  name: "task_status",
  description: "Get execution status of one or more delegated tasks. Accepts string or numeric IDs. Spanish: estado tarea delegada, verificar progreso, consultar tarea",
  parameters: {
    type: "object",
    properties: {
      task_ids: {
        type: "array",
        description: "List of task IDs (strings or numbers)",
        items: { type: "string" },
      },
    },
    required: ["task_ids"],
  },
  execute: async (params: Record<string, unknown>) => {
    const taskIds = params.task_ids as Array<string | number>;

    try {
      const tasksCol = await col<TaskDoc>("tasks");
      const ids = taskIds.map((id) => String(id).padStart(15, "0"));
      const entries = await Promise.all(ids.map((id) => tasksCol.get(id)));
      const tasks = entries.filter((e): e is NonNullable<typeof e> => !!e).map((e) => e.doc);

      const result = await Promise.all(tasks.map(async (t) => {
        let jobStatus: string | null = null;
        if (t.job_id) {
          try {
            const { getJob } = await import("../../gateway/job-store.ts");
            const job = await getJob(t.job_id);
            if (job) {
              jobStatus = job.status;
            }
          } catch { /* non-critical */ }
        }
        return {
          id: t.id,
          name: t.name,
          status: t.status,
          progress: t.progress,
          result: t.result,
          error: t.error,
          job_id: t.job_id,
          run_id: t.run_id,
          job_status: jobStatus,
          attempts: t.attempts ?? 0,
          started_at: t.started_at,
          completed_at: t.completed_at,
        };
      }));

      return {
        ok: true,
        task_count: result.length,
        tasks: result,
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
    taskReviseTool,
    taskListTool,
    taskStatusTool,
    busPublishTool,
    busReadTool,
  ];
}
