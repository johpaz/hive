
     Hive: Harness de Tareas de Larga Duración

     Context

     Pregunta original: ¿el agent loop de Hive es un harness real para tareas de larga duración?

     Diagnóstico (verificado contra el código): El loop funciona bien para turnos interactivos cortos, pero NO para trabajo autónomo de horas:
     - max_iterations = 10; al tope sintetiza y cierra sin checkpoint
     - Estado del run 100% en memoria — reinicio del proceso mata toda tarea en vuelo sin resume (agent-loop.ts:284-286, 370-371).
     - LaneQueue es un Map en memoria, no durable (gateway/lane-queue.
     - task_delegate bloqueante; task_status vestigial; task_delegate_code stub (tools/agents/index.ts:386-470).
     - projects/tasks: solo registro, sin motor ni recovery de huérfan
     - Cron durable y rehidratado al boot, pero sin catch-up de disparos perdidos (CronScheduler.ts:142-149).
     - Scaffolding inerte: DAGScheduler sin invocar, Heartbeat/Circuitno drena.

     Marco conceptual (blog Anthropic "getting started with loops"): 4 , time-based/cron ✅, goal-based ❌ (meta verificable + presupuesto), proactive ❌. Principios: paradas determinísticas, verificación antes de terminar, presupuestos explícitos.


     Restricción clave: HiveDB solo admite UN proceso con la BD abierta → diseño single-process con durabilidad (checkpoints + cola durable + leases con boot_id), no
     multiproceso.

     Principio rector: reutilizar los patrones que ya funcionan — rehir.boot(), retry OCC de updateDoc (CronScheduler.ts:156-171),notificación por canal (integration.ts:192-231).

     ---
     Plan

     1. Esquema de colecciones nuevas

     Tipos en packages/core/src/storage/collections.ts (Stage 9), índitstrap.ts (findBy sin índice lanza error).

     1.1 agentRuns — checkpoint del loop:

     interface AgentRunDoc {
       id: string
       thread_id: string; agent_id: string; user_id: string; channel:
       kind: "chat" | "worker" | "goal" | "cron" | "project"
       status: "running" | "completed" | "failed" | "interrupted" | "a
       // Presupuesto por RUN (no por turno)
       iterations_used: number; max_iterations: number
       turns_used: number; max_turns: number | null
       tokens_used: number; max_tokens: number | null
       // Goal-based stop
       goal: string | null; goal_check_tool: string | null; goal_attem
       // Checkpoint
       state_json: string; state_bytes: number
       pending_tool_calls_json: string | null
       checkpointed_at: number
       // Lease (detección de runs muertos tras crash)
       boot_id: string; lease_expires_at: number   // renovada ~30s
       resume_policy: "resume" | "mark_interrupted" | "discard"
       error: string | null
       created_at: number; updated_at: number; finished_at: number | null
     }
     Índices: status, thread_id, agent_id, kind.

     1.2 jobQueue — cola durable:

     interface JobDoc {
       id: string                 // nextId("jobQueue") → FIFO por ord
       lane: string               // sessionId / "task:<id>" — 1 running por lane
       type: "chat_turn" | "worker_task" | "project_task" | "goal_run"
       status: "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted"
       priority: number
       payload_json: string       // descriptor 100% rehidratable (sin closures)
       run_id: string             // link a agentRuns
       attempts: number; max_attempts: number   // default 2
       not_before: number
       boot_id: string | null; lease_expires_at: number | null
       result_json: string | null; error: string | null
       created_at: number; started_at: number | null; finished_at: number | null
     }
     Índices: status, lane, type, run_id.

     Clave de diseño: los callbacks vivos (ws.send, onToken) no son serializables. Un registro de ejecutores por type (gateway/job-executors.ts) re-ejecuta cualquier job
     desde su payload; en el camino "vivo" recibe callbacks efímeros drre sin ellos y notifica vía sendToUserChannel.

     1.3 Cambios a colecciones existentes:
     - TaskDoc: + job_id, run_id, thread_id, started_at, attempts (docs viejos se toleran con ?? default). Índice: tasks.job_id.
     - CronJobDoc: + misfire_policy?: "skip" | "fire_once" (default: se-shots) y misfire_grace_min?: number (default 60).

     2. Serialización del estado del loop

     Nuevo packages/core/src/agent/run-store.ts:

     interface RunCheckpointState {
       version: 1
       messages: LLMMessage[]      // JSON-plano: tool_calls/thinking_
       iterations: number
       totalInputTokens: number; totalOutputTokens: number
       lastToolSignature: string; consecutiveRepeat: number; idleIterations: number
       injectedToolNames: string[]           // tools inyectadas vía s
       systemPromptSkillSections: string[]   // secciones "## Skill:" appendeadas
     }

     Reglas:
     1. Checkpointear DESPUÉS de compactar: aplicar clearOldToolResults sobre la copia a serializar; imágenes base64 → "[imagen omitida]". Límite state_json ≤ 1.5 MB
     (truncar tool results viejos si excede).
     2. Cadencia: checkpoint tras cada round-trip de tools + en cada transición de status. Escritura OCC.
     3. Idempotencia: ANTES de executeToolBatch persistir pending_tool crash NO re-ejecutar — inyectar role:"tool" sintético "[interrupted]El proceso se reinició mientras esta herramienta corría…" y que el LLM decida.
     4. Rehidratación: compileContext + re-inyección de injectedToolNa del checkpoint.

     runAgent gana opciones: runId?, resume?, budget?: {maxIterations?l?: {text, checkTool?}, durable?: boolean. Chat corto intacto: sindurable, fila agentRuns liviana sin state_json; se promociona a durable si el turno supera ~6 iteraciones.

     3. Fases de implementación

     Fase 0 — Storage + reconciliación al boot (base de todo)
     - collections.ts + bootstrap.ts: tipos e índices nuevos.
     - Nuevo storage/reconcile.ts: reconcileOnBoot(bootId) — centraliza reparaciones de boot (mover ahí el taskRuns running→timeout de server.ts:211-220; + meetings
     "active" huérfanas → "stopped"; + stubs que las fases siguientes eHiveDb.
     - Nuevos agent/run-store.ts y gateway/job-store.ts (CRUD + lease + claim OCC pending→running).
     - Tests: tests/run-store.test.ts, tests/job-store.test.ts (round- claim OCC concurrente → solo uno gana).

     Fase 1 — Checkpoint + resume del agent loop (dep: F0)
     - agent-loop.ts: crear/actualizar agentRun, checkpoint por round-trip, pending_tool_calls_json alrededor de executeToolBatch (:309), checkpoint final en TODAS las
     salidas (:212, :239, :265, :537-601, :609). Camino resume.
     - reconcile.ts: runs "running" con lease vencida → chat a interrupted (+ aviso al canal); worker|goal|project|cron a re-encolar (F2) o interrupted.
     - SIGTERM (server.ts:2777): abort a runs activos + espera de checdown() + shutdownToolRuntime().
     - Test: LLM fake, 2 round-trips, abort, re-lanzar con resume → mensajes/iteración continúan, tool en vuelo aparece [interrupted].

     Fase 2 — Cola durable + reclaim (dep: F0; F1 para reanudar)
     - Nuevo gateway/durable-queue.ts (DurableLaneQueue): misma semántlane, prioridad, cancel, 30 min) + persistencia JobDoc por transición+ maxGlobalConcurrency (default 4). LaneQueue actual queda como dispatch interno en memoria.
     - Nuevo gateway/job-executors.ts: registro type→executor; chat_tudToUserChannel.
     - Call sites → durableQueue: server.ts:2023,2098,2238,2430 (+cancel :2169/:2684), chat.ts:117, slash-commands.ts:142,155.
     - reconcile.ts: jobs "running" lease vencida → attempts+1 → pendit, el ejecutor reanuda con resume) o interrupted si attempts ≥ max.Jobs pending → re-dispatch.
     - Test: tests/durable-queue.test.ts; manual: kill -9 mid-turn + r responde por el canal.

     Fase 3 — Budget por run + goal-based continuation (dep: F1)
     - agent-loop.ts: while pasa a iterationsThisTurn < turnCap && run.iterations_used < run.max_iterations && !stopRequested. Sin goal/budget explícito → comportamiento
     actual intacto.
     - Nuevo agent/goal-runner.ts: runGoal(...) orquesta turnos durables; al fin de cada turno verifica (tool determinística si hay goal_check_tool, sino LLM verificador
     con JSON {met, reason}); no cumplida + presupuesto → compactar y e de meta/razón/presupuesto; agotado → síntesis + failed. Presupuesto duro SIEMPRE.
     - Exponer: /goal <meta> [--tries N] en slash-commands.ts (encola a el coordinador.
     - Test: LLM fake que falla verificación 2 veces y pasa a la 3ª; presupuesto agotado.

     Fase 4 — Delegación async real (dep: F2)
     - taskDelegateTool (:386-445): param mode: "async"|"sync" (defaul real (nextId("tasks"), pending), encola worker_task (lane task:<id>), devuelve {task_id, status:"queued"} ya. Sync se mantiene con timeout 2 min.
     - Ejecutor worker_task: TaskDoc pending→in_progress, agentRun kinp con checkpoint, escribe result/error,agentBus.notifyTaskCompleted/Failed, notifica al canal.
     - taskStatusTool (:472-508): IDs string, status/progress/result riminar el éxito falso (error "not implemented" explícito).
     - Test: enqueue+ejecución con LLM fake; manual: 2 delegaciones paralelas + task_status + kill -9 con worker corriendo → reanuda.

     Fase 5 — Motor de projects/tasks (dep: F4)
     - Nuevo tools/projects/index.ts: project_create, task_create (con, project_status. Registrar en tools/index.ts + seed.
     - Nuevo scheduler/task-driver.ts (TaskDriver): event-driven (kick al completar cada job + poll de respaldo 10s): tasks pending con deps completed → claim OCC →
     enqueue project_task. Dep failed → dependientes blocked. Actualizoyecto al agotar el grafo.
     - DAG: usar TaskGraph solo para validación topológica/ciclos en create; NO usar DAGScheduler.execute() como motor (in-memory) — la fuente de verdad es HiveDB + cola
     durable.
     - reconcile.ts: tasks in_progress sin job vivo → pending (attempts+1) o failed (attempts ≥ 2).
     - Test: grafo A→(B,C)→D con fallo en B → D blocked; manual: proyead → continúa.

     Fase 6 — Cron catch-up (independiente; dep: F0)
     - CronScheduler.boot() (:44): detectar misfire (next_run_at < now recurrentes; fire_at < now one-shots activos). fire_once + dentro de misfire_grace_min → execute()
     una vez tras activar; fuera de gracia/skip → recurrentes re-agendst_error:"missed while down". Exponer misfire_policy en create/update y tool cron.create.
     - Test: docs sembrados con fire_at pasado ± gracia; manual: one-s min, arrancar → dispara.

     Fase 7 — Quick wins (independientes; en paralelo con F3-F6)
     - Timeout por tool: Tool.timeoutMs? en tools/types.ts + tools.timeouts en config; resolver override en executeToolBatch (main-thread :514-518 y pool :545). Defaults
     largos para cli_exec.
     - WS heartbeat: ping servidor→cliente cada 30s (junto al pong handler server.ts:1986) para tools largas tras proxies.
     - Retención: extender runCleanup() (:604-645) — agentRuns/jobs tete_json al terminar el run; cap 500 runs/thread.
     - Heartbeat/CircuitBreaker: instanciar Heartbeat con checks db/queueDepth/runsActive expuestos en /health; CircuitBreaker por provider envolviendo callLLM de
     ejecutores autónomos (goal/worker) — chat fuera para no cambiar U

     4. Riesgos y mitigaciones

     ┌───────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
     │          Riesgo           │                                                              Mitigación                                                              │
     ├───────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
     │ Doble ejecución al        │ Claim OCC (expectedVersion); tool en vuelo nunca se re-ejecuta → [interrupted] sintético; result por job_id idempotente              │
     │ reanudar                  │                                                                                                         │
     ├───────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
     │ Crecimiento de            │ ≤1.5 MB, imágenes fuera, state_jsona diaria                                                             │
     │ checkpoints               │                                                                                                                                      │
     ├───────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
     │ Romper UX de chat corto   │ Chat no-durable por defecto (fila liviana); promoción a durable solo en turnos largos; streaming intacto; F2 conserva semántica      │
     │                           │ LaneQueue                                                                                               │
     ├───────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
     │ Loops sin fin / costo     │ Budgets duros SIEMPRE (iteraciones/terminístico preferido; CircuitBreaker; auto-pausa a 5 fallos        │
     │                           │ (patrón cron)                                                                                                                        │
     ├───────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
     │ OCC contention            │ Single-writer por doc (solo el loop dueño escribe su run); retry ×5 existente                                                        │
     ├───────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
     │ Proceso único (HiveDB)    │ boot_id + leases detectan filas de proceso muerto; SIGTERM drena y checkpointea                                                      │
     └───────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────────┘

     5. Verificación end-to-end

     1. bun test completo tras cada fase (tests nuevos en /tests raíz,e de agent-form-fill-eval.test.ts).
     2. Escenario integral manual: proyecto con 4 tareas dependientes + /goal + cron one-shot a +2 min → kill -9 a mitad → reboot → reconcile reanuda workers desde
     checkpoint, re-dispara el one-shot, marca el turno de chat como iecto termina. Verificar agentRuns/jobQueue/tasks en HiveDB y la UI dechat.

     Archivos críticos

     - packages/core/src/agent/agent-loop.ts — checkpoint/resume, budget, goal continuation (corazón)
     - packages/core/src/storage/collections.ts + bootstrap.ts — Agentoc/CronJobDoc + índices
     - packages/core/src/gateway/lane-queue.ts → envuelta por durable-queue.ts + job-executors.ts (nuevos)
     - packages/core/src/tools/agents/index.ts — task_delegate async,
     - packages/core/src/gateway/server.ts — wiring de boot (reconcile, driver), SIGTERM drain, call sites, WS heartbeat
     - packages/core/src/scheduler/CronScheduler.ts — misfire/catch-up
     - Nuevos: storage/reconcile.ts, agent/run-store.ts, agent/goal-runner.ts, gateway/job-store.ts, gateway/durable-queue.ts, gateway/job-executors.ts, scheduler/task-driver.ts, tools/projects/index.ts
