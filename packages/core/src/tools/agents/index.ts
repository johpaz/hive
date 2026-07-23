/**
 * Agents Tools - 14 tools
 * 
 * @category agents
 */

import type { Tool } from "../types.ts";
import { col, toIndexable, fromIndexable, BROADCAST } from "../../storage/hive.ts";
import type { MemoryDoc, AgentDoc, ProviderDoc, ModelDoc, TaskDoc, AgentBusMessageDoc, SpecialistDoc } from "../../storage/collections.ts";
import type { AcceptanceCriterion } from "../../agent/run-store.ts";
import type { AwakeSpecialist } from "../../agent/specialist-runtime.ts";
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
  description: "Delegate a bounded task to either a dormant specialist_id or an existing worker_id. Specialist work is independently verified before success is returned. mode=sync blocks the conversation until done; mode=async enqueues and frees the conversation immediately — the user is notified automatically in this same chat when the specialist finishes. Prefer async unless you expect the result in a few seconds.",
  parameters: {
    type: "object",
    properties: {
      worker_id: { type: "string", description: "Existing free-worker ID. Omit when specialist_id is provided." },
      specialist_id: { type: "string", description: "Dormant specialist template ID. Preferred for common domains." },
      task_description: { type: "string", description: "Clear, detailed instructions for the worker" },
      acceptance: {
        type: "array",
        description: "Verifiable acceptance criteria. Specialist defaults are used when omitted.",
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
      mcp_server_ids: { type: "array", items: { type: "string" }, description: "Task-scoped MCP servers selected by capability search." },
      mode: { type: "string", enum: ["sync", "async"], description: "sync (default, blocking, 2min timeout — only for very short delegations) or async (enqueued, frees the conversation instantly; outcome is relayed back to the user automatically). Prefer async for anything non-trivial." },
    },
    required: ["task_description"],
  },
  execute: async (params: Record<string, unknown>, config?: any) => {
    let workerId = params.worker_id as string | undefined;
    const specialistId = params.specialist_id as string | undefined;
    const taskDescription = params.task_description as string;
    const mcpServerIds = (params.mcp_server_ids as string[] | undefined) ?? [];
    const mode = (params.mode as string) ?? "sync";

    const agentsCol = await col<AgentDoc>("agents");
    let awake: AwakeSpecialist | null = null;
    if (specialistId) {
      const { wakeSpecialist } = await import("../../agent/specialist-runtime.ts");
      const { getMCPManager } = await import("../../mcp/singleton.ts");
      awake = await wakeSpecialist({
        specialistId,
        userId: config?.configurable?.user_id ?? "",
        parentAgentId: config?.configurable?.agent_id ?? "",
        workspace: config?.configurable?.workspace ?? null,
        mcpServerIds,
        mcpManager: getMCPManager(),
      });
      workerId = awake.workerId;
    }
    if (!workerId) return { ok: false, error: "Provide specialist_id or worker_id." };
    const workerEntry = await agentsCol.get(workerId);

    if (!workerEntry) {
      await awake?.release();
      return { ok: false, error: `Worker not found: ${workerId}` };
    }
    const worker = workerEntry.doc;
    if (!worker.enabled) {
      await awake?.release();
      return { ok: false, error: `Worker is disabled: ${worker.name}` };
    }

    const taskName = taskDescription.slice(0, 60);
    const specialistEntry = specialistId
      ? await (await col<SpecialistDoc>("specialists")).get(specialistId)
      : null;
    const acceptance = ((params.acceptance as AcceptanceCriterion[] | undefined)
      ?? specialistEntry?.doc.default_acceptance.map((criterion) => ({
        id: criterion.id,
        description: criterion.description,
        checkTool: criterion.check_tool,
      }))
      ?? [{ id: "objective", description: taskDescription }]);

    // ── Async mode: create TaskDoc + enqueue worker_task in durable queue ──
    if (mode === "async") {
      try {
        const { nextId, toIndexable } = await import("../../storage/hive.ts");
        const { createRun } = await import("../../agent/run-store.ts");
        const { getDurableQueue } = await import("../../gateway/durable-queue.ts");

        const taskId = await nextId("tasks");
        const now = Date.now();
        const tasksCol = await col<TaskDoc>("tasks");
        await tasksCol.put(taskId, {
          id: taskId,
          project_id: toIndexable(null),
          agent_id: toIndexable(workerId),
          parent_task_id: null,
          name: taskName,
          description: taskDescription,
          status: "pending",
          progress: 0,
          priority: 0,
          depends_on: null,
          result: null,
          error: null,
          metadata: null,
          job_id: null,
          run_id: null,
          thread_id: null,
          specialist_id: toIndexable(specialistId),
          started_at: null,
          attempts: 0,
          created_at: now,
          updated_at: now,
          completed_at: null,
        }, { expectedVersion: 0 });

        const run = await createRun({
          thread_id: `task-${taskId}-${workerId}`,
          agent_id: workerId,
          user_id: config?.configurable?.user_id ?? "",
          channel: config?.configurable?.channel ?? null,
          kind: "worker",
          max_iterations: worker.max_iterations || 10,
          resume_policy: "resume",
          acceptance,
          specialist_id: specialistId,
        });

        const queue = getDurableQueue();
        const job = await queue.enqueue({
          lane: `task:${taskId}`,
          type: "worker_task",
          run_id: run.id,
          payload: {
            workerId,
            taskDescription,
            taskName,
            taskId,
            specialistId,
            acceptance,
            mcpServerIds,
            parentAgentId: config?.configurable?.agent_id ?? "",
            userId: config?.configurable?.user_id ?? "",
            workspace: config?.configurable?.workspace ?? null,
            // Delegating conversation's thread — lets delegation-notify.ts relay
            // the outcome back to the user once this job reaches a terminal state.
            originThreadId: config?.configurable?.thread_id ?? null,
          },
        });

        await import("../../storage/hive.ts").then(({ updateDoc }) =>
          updateDoc<TaskDoc>("tasks", taskId, {
            job_id: job.id,
            run_id: run.id,
            thread_id: `task-${taskId}-${workerId}`,
            updated_at: Date.now(),
          } as Partial<TaskDoc>)
        );

        agentBus.notifyTaskStarted(workerId, worker.name, 0, taskName, "");

        return {
          ok: true,
          task_id: taskId,
          job_id: job.id,
          run_id: run.id,
          worker_id: workerId,
          worker_name: worker.name,
          status: "queued",
          message: `Task enqueued (async). Use task_status with task_id="${taskId}" to check progress.`,
        };
      } catch (err) {
        return { ok: false, error: `Async delegation failed: ${(err as Error).message}` };
      } finally {
        await awake?.release();
      }
    }

    // ── Sync mode: blocking execution with 2min timeout (existing behavior) ──
    agentBus.notifyTaskStarted(workerId, worker.name, 0, taskName, "");

    log.info(`[task_delegate] Delegating (sync) to ${worker.name} (${workerId})`);

    try {
      const { runAgentIsolated } = await import("../../agent/agent-loop.ts");

      const threadId = `task-${Date.now()}-${workerId}`;
      const SYNC_TIMEOUT_MS = 2 * 60 * 1000;

      const { withTimeout } = await import("../../agent/agent-loop.ts");
      const { getMCPManager } = await import("../../mcp/singleton.ts");
      // Real cancellation (e.g. the user's "stop" button): the job's AbortSignal
      // reaches us via config.signal (tool-runtime/index.ts's executeToolBatch),
      // and runAgentIsolated/runAgent already honor it mid-run. withTimeout stays
      // as a hard ceiling in case the signal path doesn't stop things in time.
      const signal = config?.signal as AbortSignal | undefined;
      const result = await withTimeout(
        () => runAgentIsolated({
          agentId: workerId,
          taskDescription,
          threadId,
          mcpManager: getMCPManager(),
          signal,
        }),
        SYNC_TIMEOUT_MS,
      );

      agentBus.notifyTaskCompleted(workerId, worker.name, 0, taskName, "", result);

      if (specialistId) {
        const { verifySpecialistDelivery } = await import("../../agent/acceptance-verifier.ts");
        const verification = await verifySpecialistDelivery({
          runId: `sync-${crypto.randomUUID()}`,
          executorAgentId: workerId,
          objective: taskDescription,
          acceptance,
          delivery: result,
          mcpServerIds,
          mcpManager: getMCPManager(),
        });
        const verdict = JSON.parse(verification.verdict_json);
        if (verification.status !== "verified") {
          return {
            ok: false,
            status: verification.status,
            verification_id: verification.id,
            error: verdict.summary || "Independent verification did not authorize success.",
            retry_guidance: verdict.retry_guidance,
          };
        }
        return {
          ok: true,
          worker_id: workerId,
          worker_name: worker.name,
          specialist_id: specialistId,
          verification_id: verification.id,
          result,
        };
      }

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
    } finally {
      await awake?.release();
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
      ok: false,
      error: `Code Bridge not implemented yet. CLI "${cli}" delegation is a stub. The task was not executed: "${taskInstructions.substring(0, 100)}..."`,
    };
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
    taskDelegateCodeTool,
    taskStatusTool,
    busPublishTool,
    busReadTool,
  ];
}
