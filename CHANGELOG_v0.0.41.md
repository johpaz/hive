# CHANGELOG v0.0.41 — Hive

## ⚠️ Breaking: SQLite queda completamente reemplazado por HiveDB — sin migración de datos

Esta versión termina lo que empezó como migración puntual de búsqueda (FTS5→HiveDB) y del motor
de colecciones (probado primero en `scratchpad`): **ya no queda una sola tabla SQLite en Hive.**
Las ~30 entidades de la app —`users`, `providers`, `models`, `agents`, `channels`,
`conversations`, `summaries`, `scratchpad`, `skills`, `tools`, `ethics`, `mcpServers`,
`mcpTools`, `traces`, `playbook`, `cronJobs`, `projects`, `tasks`, `agentBusMessages`,
`meetingSessions`, tokens de auth, registros de uso, etc. (ver `storage/collections.ts`)— corren
ahora sobre colecciones de documentos de HiveDB (`@johpaz/hive-db`: redb + tantivy + hnsw_rs).
`packages/core/src/storage/schema.ts` y `storage/sqlite.ts` fueron eliminados del repo.

**No hay ruta de migración automática desde el `hive.db` (SQLite) de instalaciones anteriores.**
El bootstrap nuevo (`storage/bootstrap.ts`) lo deja explícito en su propio comentario: *"A
brand-new install never has legacy SQLite data to migrate"* — no existe un import de datos
viejos. Cualquier instalación existente que actualice arranca con la base HiveDB vacía (solo el
seed por defecto: catálogo de providers/modelos/tools/skills/ética) y el `hive.db` anterior
queda en disco sin usarse, ignorado por completo por el código nuevo.

**Por qué se acepta ahora:** la distribución todavía tiene pocos usuarios activos, y mantener un
importador para ~30 formas de tabla distintas —de un esquema que probablemente va a seguir
moviéndose mientras HiveDB madura— es mucho más costoso que pedirle a los pocos usuarios
actuales que reinstalen. Es la ventana más barata para hacer este corte limpio.

**Si actualizás desde una versión anterior:**
- Backup de `~/.hive/data/hive.db` antes de actualizar si te interesa conservar algo del
  historial — no hay forma de reimportarlo automáticamente, pero el archivo queda intacto por si
  se arma un importador manual más adelante.
- Vas a tener que recorrer el wizard de Setup de nuevo (providers, agente, canales, voz).
- Agentes, conversaciones y configuración de providers/keys de la instalación anterior no
  aparecen — es un estado nuevo, no un upgrade en el sentido tradicional.

---

## Resumen

Esta versión reemplaza **FTS5 de SQLite por HiveDB** (`@johpaz/hive-db`, motor Rust embebido propio) como motor de búsqueda de capacidades del agente (tools, skills, playbook, MCP), con soporte real de español (acentos, stemming) y parsing tolerante a texto crudo. Sobre ese mismo motor se estrena el nuevo tier de **colecciones de documentos** de HiveDB — probado primero en `scratchpad` y luego extendido al resto de la base (ver sección de arriba), completando la salida de SQLite. Sobre esas mismas colecciones se construye el nuevo **harness de tareas de larga duración**: el agent loop pasa de turnos cortos en memoria a un runner durable con checkpoints, cola persistente, metas verificables (`/goal`) y recuperación automática tras crash (ver sección dedicada más abajo). Sobre el event log de HiveDB (motor propio `hiveBD`, no la capa de colecciones) se integra además el **harness causal G9**: memoria de decisiones/tool-calls y aprendizaje retrospectivo detrás de un flag apagado por defecto (`causalLog.enabled`), validado con LLM real — ver sección dedicada. También se **elimina por completo el soporte de LLM local** (`llama-server`), se **consolida HiveAgents a un solo modelo** (Qwen-AgentWorld, optimizado para agentes/tool-use), se reescribe la **resolución de providers de voz** (STT/TTS) para que dependa de la base de datos en vez de adivinar por el nombre del modelo, y se retiran los **modelos/providers hardcodeados como fallback** (`gpt-4o`, `gpt-4o-mini`, `whisper-large-v3-turbo`, `gemini-2.0-flash`...) en favor de resolución real contra la base de datos en creación de agentes, compactación de contexto, reuniones y OCR.

---

## Búsqueda de Capacidades: Migración de FTS5 (SQLite) a HiveDB

### Por qué

FTS5 no tenía stemming ni manejo real de acentos en español (parcheado con wildcards y un diccionario ES→EN a mano), no soportaba delete/upsert limpio (el índice se reconstruía completo en cada sync), y los umbrales de relevancia eran negativos y ajustados a ojo. El motor propio **HiveDB** (`@johpaz/hive-db`, Rust: `redb` + `tantivy` BM25 + `hnsw_rs` + RRF, binding `napi-rs`) resuelve las tres cosas.

### Motor (hiveBD, paquete `@johpaz/hive-db`)

- Analyzer español `es_folded`: minúsculas → plegado de acentos → stemming Snowball, aplicado ANTES del stemmer ("transacción" ≈ "transaccion", "pagos" ≈ "pago").
- Esquema multi-campo con pesos: `name` (4.0) > `tags` (3.0) > `body` (2.0).
- `upsertDoc` / `upsertBatch` / `deleteDoc` / `deleteByFilter` / `clearIndex` — soporte real de delete/upsert (antes solo existía `indexDoc`, ahora deprecado).
- Parsing tolerante: comillas sin cerrar, operadores, `¿?` — el texto crudo del usuario nunca lanza error.
- Semántica de scores: BM25 crudo (solo texto) / similitud coseno (solo vector) / RRF (híbrido) — siempre positivo, mayor = mejor.
- `HiveDB.open(":memory:")` para tests; dimensión de vector configurable por base (`OpenOptions.vectorDimension`).

### Integración en Hive

- **Nuevos módulos:** `packages/core/src/storage/hivedb.ts` (singleton `getSearchDb()`), `packages/core/src/agent/capability-search.ts` (capa única de búsqueda: convención de ids `tool:`/`skill:`/`playbook:`/`mcp:`, filtro por `type`, corte relativo de relevancia `score ≥ 0.3 × top` — nunca un umbral absoluto).
- `tool-selector.ts`, `skill-selector.ts`, `playbook-selector.ts` reescritos: `selectTools`/`selectSkills`/`selectPlaybookRules` ahora **async**, usan `searchCapabilities` en vez de construir queries FTS5 a mano.
- `mcp/tool-sync.ts`: sync de herramientas MCP reescrito sobre `deleteByFilter` + `upsertBatch`.
- `tools/core/index.ts`: `search_knowledge` reescrito sobre la nueva capa; se conserva el diccionario ES→EN (el stemming no traduce entre idiomas) hasta que HiveDB tenga embeddings.
- `gateway/initializer.ts`: abre HiveDB antes de sincronizar tools/skills/playbook/MCP.

### Fix: nombres de herramientas MCP contaminaban la búsqueda

Reportado en producción: buscar una palabra genérica devolvía el catálogo entero (~60 tools) de un servidor MCP con nombre genérico como "herramientas administrativas".

- **Causa 1:** el `server_name` se indexaba como texto buscable en `tags`.
- **Causa 2:** `mcpToolFullName` truncaba el string combinado desde el final al pasar 64 caracteres, cortando el nombre distintivo de la tool en vez del prefijo del servidor.
- **Fix:** el `server_name` ya no es texto buscable (el prefijo en el *id* sigue siendo necesario para unicidad de function names); `mcpToolFullName` ahora acorta el prefijo del SERVIDOR (mínimo 8 caracteres) para que el nombre de la tool siempre sobreviva intacto; nombres camelCase (`crearEvento`) se indexan también separados (`crear Evento`); `mcpToolId` delega en `mcpToolFullName` para que nunca diverjan.
- **Migración `v0.0.43`** recompila los ids de `mcp_tools` ya almacenados con el nuevo algoritmo.

### Limpieza

- `storage/schema.ts`: eliminadas las 4 tablas virtuales `tools_fts` / `skills_fts` / `playbook_fts` / `mcp_tools_fts` y sus índices.
- `storage/seed.ts`: ya no crea ni sincroniza triggers/tablas FTS5 (incluye fix de un bug que solo se manifestaba en instalaciones nuevas: `seedAllData()` todavía escribía en `playbook_fts`, inexistente tras el schema nuevo).
- Retirados los tests obsoletos de FTS5 (`test_fts5_query.ts`, `test_fts5_db.ts`, `fts5-improvement-test.ts`, `verify_fts_robust.ts`, `test_mcp_fts5.ts`, `test_search_knowledge.ts`, `test_mcp_search.ts`, `test_mcp_search_validation.ts`) → nuevo `tests/hivedb-search.test.ts` (9 tests de integración sobre índice `:memory:`).
- `docs/ARCHITECTURE.md`, `docs/SKILLS-MANUAL-USUARIO.md`: referencias a FTS5 actualizadas a HiveDB.

### Complemento: el propio agente seguía "pensando" en FTS5

La migración de motor había quedado completa en el código, pero no en lo que el agente lee de
sí mismo en cada turno — el skill core que enseña a usar `search_knowledge` seguía nombrado y
redactado para el motor viejo, con una instrucción de comportamiento que dejó de ser cierta.

- **Bug de comportamiento real, no solo cosmético**: el skill siempre-cargado `busqueda_fts5`
  instruía *"AND entre palabras no encuentra nada"* — cierto para FTS5 (que ANDea términos
  bareword por defecto), pero falso para HiveDB: se verificó contra el motor
  (`hiveBD/crates/hivedb-index/src/text.rs`) que los términos se combinan con `Occur::Should`
  (OR), rankeados por BM25. El agente venía recibiendo una regla activamente incorrecta sobre
  su propia herramienta de descubrimiento en cada conversación.
- Renombrado el skill `busqueda_fts5` → `capability_discovery` (carpeta, `name` del frontmatter,
  y las dos listas `MINIMAL_SKILL_NAMES` en `skill-selector.ts`/`context-compiler.ts`); corregida
  la guía de comportamiento: una frase de varias palabras ya no falla, solo diluye precisión
  frente a una keyword única.
- Comentarios de código que describían el matching actual como "FTS5" (`tool-selector.ts`,
  `skill-selector.ts`, `tools/core/index.ts`) actualizados a "BM25".
- `docs/AGENT_LOOP_CONTEXT_COMPILER.md` y `README.md`: reescritas las secciones específicas de
  FTS5 (selectores, umbrales, esquema de índice) para reflejar el índice único de HiveDB y el
  corte relativo de relevancia (`0.3 × mejor score`, no los umbrales absolutos negativos viejos:
  `-30`/`-15`). Señalado (no reescrito) que ambos documentos aún describen el resto de la capa de
  storage como si fuera SQLite —incluyendo referencias a `storage/schema.ts`/`storage/sqlite.ts`,
  que ya no existen— como deuda documental pendiente más allá del alcance de FTS5.

---

## Colecciones de Documentos en HiveDB: Motor General + Caso Detallado `scratchpad`

### Motor: Gate G10 (hiveBD, `@johpaz/hive-db@0.2.0`)

Cuarto tier de almacenamiento junto al event-log, la memoria semántica y la working memory: CRUD mutable de documentos JSON sobre `redb` — la pieza que permitió reemplazar por completo las tablas relacionales de SQLite (ver el aviso de breaking change al inicio del documento: la migración terminó cubriendo las ~30 entidades de la app, no solo `scratchpad`).

- **Versionado optimista:** `put(id, doc, { expectedVersion })` — `expectedVersion: 0` crea solo si no existe; falla con `version conflict` si no coincide.
- **Índices secundarios de igualdad**, opcionalmente `unique`, con backfill automático al crearse.
- **Scan** con `prefix` / `offset` / `limit` / `reverse`.
- **Batches atómicos** multi-colección (`ColOp::Put | Delete`), todo o nada.
- API TypeScript: `db.collection<T>(name)` → `.put/.get/.delete/.scan/.count/.createIndex/.findBy`; `db.batch(ops)`.
- Publicado en npm como `@johpaz/hive-db@0.2.0` (junto con G9, distribución multiplataforma con `@napi-rs/cli`: 6 targets).

### Bootstrap general: `storage/bootstrap.ts` reemplaza `initializeDatabase()` + `seedAllData()` + `runStartupMigrations()`

Con la salida completa de SQLite ya no hace falta una lista de migraciones version-gated: `ensureHiveDb()` abre la base, asegura los índices secundarios de cada colección (~30 entradas en `INDEXES`, cubriendo las relaciones que antes eran foreign keys — `models.provider_id`, `agents.user_id`, `tasks.project_id`, etc.) y reseedea los catálogos estáticos en cada boot vía `putIfAbsent`, para no pisar `enabled`/`active` que el usuario ya haya tocado.

### Caso detallado — `scratchpad`: primer módulo migrado a mano, documentado como referencia del patrón

`scratchpad` fue el primer módulo migrado fuera de SQLite (se descartó `tool_cache` como candidata inicial: existía en el schema pero no tenía ningún código que la usara), y quedó documentado en detalle porque el mismo patrón se aplicó después al resto de las colecciones:

- **Diseño:** `id = "<threadId>:<key>"` — listar las notas de un hilo es un `scan({ prefix })`, sin necesitar índice secundario.
- `packages/core/src/agent/conversation-store.ts`: `saveScratchpadNote` / `getScratchpad` / `deleteScratchpadNote` ahora async sobre `HiveDB.collection("scratchpad")`; nueva `listAllScratchpadNotes` para el panel admin.
- Desempate de orden por `seq` monotónico por proceso: dos notas guardadas en el mismo tick de reloj (fácil con llamadas `await` rápidas) ya no quedan en orden ambiguo — mejora real sobre el comportamiento anterior en SQLite, donde `ORDER BY updated_at DESC` tenía la misma ambigüedad silenciosa en empates.
- Call sites actualizados a `await`: `context-compiler.ts` (inyección de notas al system prompt), `tools/core/index.ts` (tool `save_note`, ahora delega en `saveScratchpadNote` en vez de duplicar el SQL), `gateway/routes/chat.ts` (`/api/notes`, `handleGetNotes`/`handleUpdateNote`).
- Contrato de API sin cambios para el frontend: `listAllScratchpadNotes` devuelve el mismo shape snake_case + epoch-segundos que antes (`packages/hive-ui/src/types/notes-crons.ts` solo cambia `id: number` → `string`; `NotesPanel.tsx` no requirió cambios).
- Tests nuevos: `tests/scratchpad.test.ts` (7 tests de integración).

---

## Harness de Tareas de Larga Duración: Checkpoints, Cola Durable y Metas Verificables

### Por qué

Diagnóstico contra el código: el agent loop funcionaba bien para turnos interactivos cortos pero no para trabajo autónomo de horas — `max_iterations = 10` sin checkpoint (al tope sintetiza y cierra), estado del run 100% en memoria (un reinicio de proceso mataba cualquier tarea en vuelo sin resume), `LaneQueue` era un `Map` en memoria no durable, `task_delegate` era bloqueante con `task_status` vestigial, el motor de projects/tasks era solo registro sin recovery de huérfanas, y el cron no tenía catch-up de disparos perdidos durante un downtime. Contra el marco de "loops" de Anthropic: time-based/cron cubierto, pero goal-based (meta verificable + presupuesto) y proactive, no.

**Restricción de diseño clave:** HiveDB solo admite un proceso con la base abierta, así que la durabilidad se resuelve con checkpoints + cola durable + leases por `boot_id` en un diseño single-process, no multiproceso.

### Checkpoints del agent loop (`agentRuns`)

- Nueva colección `agentRuns` (HiveDB): serializa `messages`, contadores de iteración/tokens, nombres de tools inyectadas y secciones de skill del system prompt (`agent/run-store.ts`), con escritura OCC (`expectedVersion`).
- Checkpoint tras cada round-trip de tools y en cada transición de status; `state_json` acotado a ≤ 1.5 MB (compactación + imágenes base64 reemplazadas por `"[imagen omitida]"`, tool results viejos truncados si excede).
- **Idempotencia ante crash:** antes de ejecutar un batch de tools se persiste `pending_tool_calls_json`; si el proceso muere a mitad de una tool, esa tool **no se re-ejecuta** al reanudar — se inyecta un mensaje sintético `role: "tool"` con `"[interrupted] El proceso se reinició mientras esta herramienta corría…"` y el LLM decide cómo seguir.
- Chat corto sigue siendo liviano por defecto (fila `agentRuns` sin `state_json`); se promueve a durable automáticamente cuando un turno supera ~6 iteraciones.
- `runAgent` queda envuelto en try/catch/finally: una excepción hace `failRun` + libera el lease; el abandono del generator (el consumidor corta el stream) deja el run `interrupted` con el checkpoint preservado.

### Cola durable (`jobQueue`)

- Nueva colección `jobQueue` con prioridad, `lane` (sesión o `task:<id>`, 1 job corriendo por lane), `attempts`/`max_attempts` y lease por `boot_id` (`gateway/job-store.ts`).
- `gateway/durable-queue.ts` (`DurableLaneQueue`) envuelve la `LaneQueue` en memoria existente con persistencia por transición de estado, re-despacho de todo lo `pending` al boot, cancelación real de jobs corriendo, y `maxGlobalConcurrency` (default 4) — los jobs `chat_turn` quedan **fuera** de ese cap global para que workers ocupados no congelen el webchat.
- `gateway/job-executors.ts`: registro `type → executor` (`chat_turn`, `worker_task`, `project_task`, `goal_run`); cada job se puede re-ejecutar por completo desde su `payload_json` (100% serializable, sin closures) porque callbacks vivos como `ws.send`/`onToken` no lo son.

### Chat durable

- Los 5 caminos de chat (WS message/audio/a2ui/canvas + API HTTP) ahora encolan jobs `chat_turn` en vez de correr el loop directo (`gateway/server.ts`, `gateway/routes/chat.ts`).
- `gateway/webchat-turn.ts`: el turno corre con un payload 100% serializable; si hay socket vivo recibe callbacks efímeros (streaming en caliente), si no, corre headless y entrega la respuesta por `sendToUserChannel` — así un turno interrumpido por crash se re-ejecuta al reiniciar y de todos modos le llega al canal, aunque el cliente HTTP original ya haya recibido un 504.

### Metas verificables (`/goal`)

- Nuevo `agent/goal-runner.ts`: `runGoal(...)` orquesta múltiples turnos durables hasta cumplir una meta o agotar presupuesto — verificación por tool determinística (`goal_check_tool`) o, si no hay una, por LLM verificador que responde JSON `{met, reason}`.
- Meta no cumplida con presupuesto restante → compacta contexto y sigue con el próximo turno; presupuesto agotado → síntesis final y `failed`. Presupuesto duro siempre activo (iteraciones/turnos/tokens por run, no por turno).
- Nuevo comando `/goal <meta> [--tries N] [--check-tool tool]` (`gateway/slash-commands.ts`) que encola un `goal_run` asíncrono.

### Delegación asíncrona y motor de proyectos/tareas

- `task_delegate mode=async` (`tools/agents/index.ts`) ya no bloquea: crea la `TaskDoc`, encola `worker_task` en su propia lane y devuelve `{task_id, status: "queued"}` de inmediato (el modo síncrono se conserva con timeout de 2 min); `task_status` ahora reporta estado/progreso/resultado reales en vez de ser vestigial.
- Los workers de `worker_task`/`project_task` corren aislados, checkpointean y pueden reanudar a mitad de tarea.
- Nuevo `tools/projects/index.ts`: `project_create`, `task_create` (con dependencias), `project_status`.
- Nuevo `scheduler/task-driver.ts` (`TaskDriver`): event-driven (kick al completar cada job + poll de respaldo cada 10s) — tareas `pending` con dependencias `completed` se reclaman con OCC y se encolan como `project_task`; una dependencia `failed` bloquea a sus dependientes. `TaskGraph` se usa solo para validar el grafo (ciclos) al crear; el motor de ejecución real es HiveDB + la cola durable, no el `DAGScheduler` in-memory existente (que queda sin invocar para este flujo).

### Catch-up de cron

- `scheduler/CronScheduler.ts`: al boot se detectan disparos perdidos (recurrentes con `next_run_at` vencido; one-shots activos con `fire_at` vencido). Dentro de `misfire_grace_min` (default 60) se ejecutan una vez; fuera de gracia, los recurrentes se reagendan y los one-shots quedan `failed` con `last_error: "missed while down"` — nunca quedan zombies en estado `active` para siempre.
- Nuevo campo `misfire_policy: "skip" | "fire_once"` por `CronJobDoc`, expuesto en creación/actualización y en la tool de cron.

### Reconciliación al boot y cierre ordenado

- Nuevo `storage/reconcile.ts` (`reconcileOnBoot`): como HiveDB es de un solo proceso, **toda** fila `running` al boot pertenece a un proceso muerto y se repara de inmediato sin esperar a que venza el lease — runs de chat pasan a `interrupted` con aviso al canal; runs worker/goal/project/cron se re-encolan o quedan `interrupted`; tareas `queued`/`in_progress` sin job vivo vuelven a `pending` o `failed` según intentos agotados. Los leases quedan como respaldo en runtime, no como mecanismo primario.
- `SIGTERM`: aborta runs activos y espera a que checkpointeen antes de cerrar (`server.ts`), sumado a `shutdownToolRuntime()`.

### Quick wins

- Timeout configurable por tool (`Tool.timeoutMs?`, `tools.timeouts` en config — `config/loader.ts`, `tool-runtime/index.ts`), con default largo para `cli_exec`.
- Heartbeat de WebSocket cada 30s (servidor → cliente) para sobrevivir proxies con tools largas.
- Retención: `agentRuns`/`jobQueue` limpian `state_json` al terminar el run; cap de 500 runs por thread.
- Circuit breakers expuestos en `/health` junto con métricas de cola/runs activos.

### Bugs de durabilidad encontrados y corregidos en revisión

Una versión anterior de la implementación se dio por completa, pero la revisión encontró que la Fase 2 (chat durable) no estaba cableada y la Fase 3 (goal continuation) era un placeholder (`verifyGoal` corría el check tool con `allTools: []` y decidía con `includes("true")`), además de 7 bugs de durabilidad:

1. Una excepción del LLM dejaba el run `running` con el lease renovándose para siempre (faltaba el try/finally; `failRun` estaba importado pero nunca se llamaba).
2. Los jobs `pending` de un boot anterior nunca se volvían a despachar.
3. El reclaim esperaba leases de 30 min (jobs) / 2 min (runs) aunque el proceso es único — un reinicio rápido dejaba runs huérfanos para siempre.
4. `resume` se leía del payload (siempre `false` en un reclaim), así que el checkpoint nunca se usaba, y el run reanudado quedaba `interrupted` sin renovar el lease.
5. El `TaskDriver` encolaba sin claim OCC — el poll de 10s duplicaba jobs.
6. Import duplicado de `Config` en `tool-runtime/index.ts` (error de TypeScript introducido por la implementación base).
7. Un one-shot de cron perdido fuera de la ventana de gracia quedaba `active` para siempre.

### Archivos

**Nuevos:** `storage/boot-id.ts`, `storage/reconcile.ts`, `agent/run-store.ts`, `agent/goal-runner.ts`, `gateway/job-store.ts`, `gateway/durable-queue.ts`, `gateway/job-executors.ts`, `gateway/webchat-turn.ts`, `scheduler/task-driver.ts`, `tools/projects/index.ts`.

**Modificados:** `agent/agent-loop.ts` (checkpoint/resume/budget + try/finally), `agent/providers/index.ts` (opciones durables en `generate`), `gateway/server.ts` (wiring de boot, call sites WS → `enqueueChatTurn`, cancel → `cancelLane`, SIGTERM, heartbeat WS, `/health`), `gateway/routes/chat.ts`, `gateway/slash-commands.ts` (`/goal`), `scheduler/CronScheduler.ts` (misfire), `storage/collections.ts` + `bootstrap.ts` (`AgentRunDoc`, `JobDoc`, `TaskDoc.queued`, índices nuevos), `tools/agents/index.ts` (`task_delegate` async, `task_status` real), `tool-runtime/index.ts` (timeouts por tool), `config/loader.ts` (`tools.timeouts`).

### Verificación

55 tests nuevos del harness en verde (`run-store`, `job-store`, `agent-loop-resume`, `retention-cap`, `agent-loop-integration`, `durable-queue`, `goal-runner`, `cron-misfire`, `task-driver`, `agent-loop-failure`) + 45 tests adyacentes sin regresión, typecheck limpio (solo los 2 errores de TS preexistentes conocidos, no relacionados), y smoke de boot con `SIGKILL` simulado a los 20s seguido de un segundo boot limpio sobre la base "sucia".

**Pendiente manual** (requiere entorno configurado, no cubierto por CI): turno de webchat real con streaming + stop, `kill -9` con un worker en vuelo y verificación visual del resume.

### Limitaciones conocidas

- Los turnos de un `goal_run` no checkpointean intra-turno: un crash a mitad de turno re-ejecuta ese intento completo (el historial del thread preserva el progreso previo).
- El payload de un `chat_turn` multimodal guarda imagen/documento en base64 dentro de `payload_json` (se limpia con la retención de 500 jobs/run).
- Un turno de la API HTTP recuperado tras un crash responde por el canal de webchat; el cliente HTTP original no recibe esa respuesta (ya recibió un 504).

---

## Harness Causal G9: Memoria de Decisiones sobre el Event Log de HiveDB

### Por qué

El motor propio (`hiveBD`) ya traía implementada su capa de análisis causal retrospectivo (Gate G9: `causalThread`/`buildAgentContext`/`evaluateHarness`/`toolStats`, sobre un event log append-only separado del tier de colecciones) desde antes de esta versión — pero `hive` nunca llegó a llamar `db.append()` en ningún lado. Todo el pipeline de aprendizaje existente (`reflector.ts`/`curator.ts`) operaba a ciegas sobre el último lote de 30 traces, sin memoria causal de qué decisión causó qué llamada a herramienta ni de la cadena completa de un run.

**G9 no reemplaza** el harness de tareas de larga duración de la sección anterior — son capas distintas: G9 es observabilidad/aprendizaje retrospectivo sobre el event log, no cola de jobs, checkpoint/lease, ni verificación de metas (eso lo sigue resolviendo el harness durable). El propio contrato de hiveBD (`docs/AGENT_INTEGRATION.md`) es explícito en esa separación.

### hiveBD: generalización a motor multi-agente + fix de `correlation`

- **v0.3.0**: el harness G9 dejó de asumir implícitamente el vocabulario de hiveCode — documentado como contrato genérico (`docs/AGENT_INTEGRATION.md`, vocabulario MUST/SHOULD/MAY de eventos) con un ejemplo deliberadamente ajeno (triage de tickets de soporte). Se corrigió además un bug real de contrato: `ToolLedger` parseaba `outcome` como string en minúsculas mientras `CausalThread` esperaba el shape tipado (`"Ok" | "Timeout" | {Err}`) — ambas proyecciones ahora comparten `parse_tool_outcome()`. Se resolvió también una colisión de nombres entre el marcador de proyección `CausalThread` y el struct de datos homónimo (renombrado a `CausalThreadProjection`).
- **v0.3.1**: el binding napi (`JsEventInput`) no exponía `correlation` — el lado de lectura (`JsEvent`) sí lo tenía, un gap asimétrico que dejaba `objectiveDrift` permanentemente imposible de disparar para cualquier consumidor JS/TS, sin ningún error visible.

### Integración en `hive`: flag `causalLog.enabled` (apagado por defecto)

Nuevo flag en `config/loader.ts` (env `HIVE_CAUSAL_LOG=true`) — agrega N+M+1 llamadas `await db.append()` al camino crítico de cada turno, así que arranca apagado hasta validar impacto real en producción.

- **`agent-loop.ts`**: cada invocación de `runAgent()` mintea un `causalStreamId` (reusado en resume vía `opts.runId`, nunca el `threadId` persistente — `causalThread()` reconstruye sin proyección checkpointeada, así que un hilo de meses sería O(historial completo) en cada llamada) y emite `IntentLogged` → `StateTransition` (uno por decisión del LLM, encadenado a la decisión anterior) → `ToolCall` (uno por herramienta, encadenado a la decisión que lo pidió, no a la tool anterior) con el shape canónico de `outcome` derivado directo de `ToolBatchResult.ok/timedOut/error`.
- **`reflector.ts`**: `toolStats()` reemplaza los contadores armados a mano sobre el lote de 30 traces por agregados de *todo el historial* del event log para los insights de fallas/latencia por tool. Nueva `analyzeCausalThreads()`: `evaluateHarness()` por cada stream causal tocado por el batch agrega insights `root_cause` (causa raíz de una falla, con evidencia causal real) y `learning_proposal` (propuestas con score de confianza propio del harness) — fuente adicional, no reemplaza el análisis local existente.
- **`curator.ts`**: `mapInsightTypeToCategory()` extendido para los 2 tipos nuevos (`root_cause`→`error_avoidance`, `learning_proposal`→`response_quality`).
- **`context-compiler.ts`**: nueva sección `# CAUSAL CONTEXT` en el system prompt vía `buildAgentContext()`, inyectada solo cuando la compactación ya se disparó ese turno (no en cada turno — es un round-trip real a la DB), con una línea explicando qué es y cómo pesarla frente a la conversación actual. `episodicSimilarity` queda deliberadamente afuera: requiere embeddings que hive no genera en ningún lado todavía.

### 2 bugs reales encontrados en la validación (no solo simulados — confirmados con LLM real)

Una simulación local de actividad de agente (mocks) y una prueba real contra Gemini 3.5 Flash encontraron:

1. **Insights duplicados**: `evaluateHarness()` siempre emite tanto `rootCause` como un `finding` equivalente `{kind:"rootCause"}` desde la misma resolución — el código original los convertía en 2 insights separados, duplicando cada regla de playbook por cada falla real.
2. **Reforzamiento roto**: el texto de la regla `root_cause` incluía el `causalStreamId` (único por run) — como `curator.ts` solo refuerza una regla existente cuando el prefijo de 60 caracteres coincide exacto, cada ocurrencia de la *misma* causa raíz en runs distintos creaba una regla nueva en vez de incrementar `helpful_count` de una existente. El playbook iba a crecer sin límite con tráfico real.

### Prototipo de factibilidad: suscripciones en tiempo real

Nuevo `hive causal watch [--agent <id>] [--stream <id>]` (`watchCausalEvents()` en `storage/causal-events.ts`, sobre `db.events()` de HiveDB) — live-tail del event log causal. Probado de punta a punta contra un turno real de Gemini.

**Hallazgo real durante la verificación**: HiveDB solo permite un proceso con la base de datos abierta a la vez, sin modo de solo-lectura compartido — `hive causal watch` no puede correr en paralelo con un `hive dev`/`hive start` activo sobre la misma base. Falla ahora con un mensaje claro en vez de un stack trace críptico. Conectar esto al layer de WebSocket/UI (para que sea útil observando un gateway real en vivo) queda para la siguiente versión.

### Scripts de validación real

- `scripts/bench-causal-log.ts`: compara latencia real (LLM real, no mock) con el flag apagado/prendido, intercalado para promediar el jitter de red del LLM en vez de que se confunda con el costo del flag.
- `scripts/inspect-playbook-health.ts`: reporte de salud del playbook sin costo de cuota — incluye detectores de regresión directos de los 2 bugs de arriba (prefijos duplicados, identificadores tipo UUID filtrados en el texto de las reglas).

### Verificación

19 tests nuevos (`agent-loop-integration`, `reflector`, `curator`, `context-compiler`, `causal-events`, `skill-selector`), suite completa sin regresiones, y validación real contra Gemini 3.5 Flash en cada fase (no solo mocks).

### Limitaciones conocidas

- `objectiveDrift` queda técnicamente cableado pero no se dispara en la práctica: hive comparte un solo `correlation` por turno, sin clasificador de cambio de tema.
- La corrida real de `bench-causal-log.ts` (3 muestras) fue inconclusa — el jitter de red del LLM domina por completo la señal con esa cantidad de muestras; hacen falta más para una decisión de "prender por defecto".
- El playbook no tiene datos orgánicos de G9 todavía — falta una ventana real de uso multi-día.

---

## Fix: Function-Calling Roto en Gemini/Anthropic/Ollama por Schema de Arrays sin `items`

Encontrado incidentalmente durante la validación real de G9: una llamada real a Gemini falló con `GenerateContentRequest...items: missing field` — el tool `office_escribir_xlsx` declaraba un campo `datos: { type: "array" }` sin `items`. Es JSON Schema válido (items es opcional por spec), pero el validador de function-calling de Gemini lo rechaza.

Auditado el catálogo completo de 73 tools nativos: solo ese tool tenía el problema. Pero el riesgo real no es solo los tools propios de hive — un servidor MCP externo, fuera de control, podría mandar el mismo schema inválido y romper igual, así que el fix va al límite de wire, no solo al tool puntual:

- Nueva `ensureArrayItems()` en `agent/llm-providers/interface.ts`: rellena recursivamente un `items: {}` (acepta cualquier cosa) en todo nodo `{type:"array"}` sin uno.
- Cableada en `normalizeToolSchema()` (los 10 providers OpenAI-compatible ya la heredan automáticamente) y agregada directo en los 3 adaptadores que arman su request sin pasar por ahí: `gemini.ts`, `anthropic.ts`, `ollama.ts`.
- Fix puntual también en `office_escribir_xlsx.ts` (defensa en profundidad — el schema fuente debe ser válido en sí mismo, más allá de cualquier parche a nivel adaptador).

Verificado en producción real: se repitió el mismo mensaje que había fallado, la segunda llamada (la que antes rompía) ahora responde bien.

---

## Fix: Headers Redundantes Anidados en el System Prompt (Ética + 29 Skills)

Encontrado auditando manualmente el system prompt real compilado en busca de fugas/duplicados. No era duplicación de texto exacto (por eso no lo detectaban los chequeos automáticos previos), sino jerarquía de headers rota: contenido que se auto-titula con un `#` (H1) quedando anidado DEBAJO de su propio wrapper `##` (H2) — el mismo concepto repetido dos o tres veces por sección.

- **Ética por defecto** (`storage/seed.ts`): el contenido de la regla `default` empezaba con su propio `# Ética del Agente`, redundante con el wrapper (`# ÉTICA Y REGLAS CONSTITUCIONALES` + `## Ética por Defecto` del `rule.name`). Corregido en la plantilla fuente y en el documento ya sembrado en la base de datos local (el seed es `putIfAbsent`, no pisa lo que ya existe).
- **Las 29 skills empaquetadas**: mismo patrón, sistémico — cada `SKILL.md` se autotitula después del frontmatter (para que se lea bien standalone), pero los 4 puntos de inyección al system prompt (`context-compiler.ts`, 3 en `agent-loop.ts`) ya envuelven el body con su propio `## <nombre_skill>`. Arreglado en un único punto (`toSkillDescriptor()` en `skill-selector.ts`), sin tocar los 29 archivos fuente ni los 4 call sites — cada skill sigue siendo legible standalone, pero la copia que recibe el LLM sale limpia.

Verificado contra la base de datos real: la jerarquía de headers del system prompt de Bee quedó consistente (`#` > `##`, sin anidamiento invertido) en una prueba real con Gemini.

---

## HiveAgents: Modelo Único + Validación de API Key

### Consolidación a Qwen-AgentWorld

El catálogo de 9 variantes GGUF (Qwen3.6, Gemma 4, Qwopus3.6 en varias cuantizaciones) se reduce a un solo modelo recomendado: `Qwen-AgentWorld-35B-A3B-UD-Q4_K_M.gguf`, optimizado para agentes, tool-use y MCP (contexto 200K, antes 50K).

- `packages/core/src/storage/seed.ts`: catálogo de modelos HiveAgents reducido a esta única entrada.
- `packages/core/src/agent/llm-providers/hiveagents.ts`: nueva detección `_isAgentWorld()`; el control de thinking vía `chat_template_kwargs.enable_thinking` ahora aplica a Gemma 4 **y** Qwen-AgentWorld.
- `packages/cli/src/commands/onboard.ts`: wizard de CLI actualizado al modelo único.
- `API.md`: reescrito — nueva sección "Tool Calls desde el frontend" con el flujo completo y un gotcha crítico documentado sobre `max_tokens`; ejemplos reales de streaming con tool calls y formato de historial de mensajes; sección de modelo y rendimiento con el razonamiento de por qué un solo modelo.

### Validación de API key / estado del servicio

- `gateway/routes/setup.ts`: `handleVerifyProvider` ahora hace un chequeo real contra `HIVEAGENTS_BASE_URL/api/status` con la API key, distinguiendo 401/403 (key inválida) de otros errores de conexión — antes HiveAgents no se validaba en absoluto.
- `hive-ui/modules/agents/ModelSelector.tsx`: `hiveagents` se trata igual que `ollama` para el chequeo de "tiene API key" en el selector (no bloquea la UI esperando una key que no aplica de la misma forma).

---

## Remoción Completa de Local LLM (`llama-server`)

Se elimina el subsistema completo que gestionaba descarga, detección y arranque de modelos GGUF locales vía `llama-server` (~2500 líneas):

- **Backend:** `packages/core/src/gateway/llm-local/{client,detector,downloader,index,manager,models,server}.ts`, `packages/core/src/gateway/routes/llm-local.ts`, `packages/core/src/agent/llm-providers/local-llama.ts`.
- **Frontend:** `packages/hive-ui/src/modules/providers/LocalLLMCard.tsx`, `packages/hive-ui/src/modules/providers/tabs/TextModelsTab.tsx`, `packages/hive-ui/src/lib/models.ts`, el slice `LocalLLMState`/`LocalLLMStatus` completo de `useGlobalConfigStore.ts`.
- **Docs:** `docs/LOCAL-LLM-SETUP.md` eliminado.
- **Migración `v0.0.41`**: desvincula agentes con `provider_id = 'local-llama'` (los deja sin provider/modelo asignado en vez de dejar una referencia rota), borra sus modelos y el provider de la tabla `providers`.

HiveAgents (modelo remoto vía Cloudflare) es ahora la única vía para correr el modelo recomendado sin depender de una API key de terceros.

---

## Fin de los Fallbacks Hardcodeados: Resolución de Modelo por Defecto desde la BD

Varios puntos del código caían silenciosamente en un provider/modelo fijo (`"openai"` + `"gpt-4o"`/`"gpt-4o-mini"`, `"whisper-large-v3-turbo"`, `"gemini-2.0-flash"`, `"claude-haiku-4-5-20251001"`) cuando no se especificaba uno — funcionaba solo por casualidad si ese provider en particular estaba configurado, y fallaba en silencio o contra el provider equivocado si no.

- **Nuevo `getDefaultLLM()`** en `packages/core/src/agent/llm-client.ts`: resuelve `{ provider, model }` desde la BD — primero el agente `coordinator`, si no el primer modelo LLM activo de un provider activo; `null` si no hay nada configurable (instalación nueva antes del setup).
- **`agent/compaction.ts`**: `compactThread` (resumen de contexto) usaba `openai`/`gpt-4o-mini` como fallback fijo cuando no encontraba el agente coordinador; ahora usa `getDefaultLLM()` y lanza error explícito si no hay ningún LLM configurado, en vez de intentar llamar a un provider sin key.
- **`gateway/routes/agents.ts`**: `handleCreateAgent` ya no asume `"openai"`/`"gpt-4o"` cuando el request no trae `providerId`/`modelId`.
- **`gateway/routes/meeting.ts`**: `handleCreateMeeting` resuelve el modelo STT por defecto contra el primer modelo `stt` activo en la BD en vez de asumir `"whisper-large-v3-turbo"` siempre disponible.
- **`multimodal/vision-service.ts`**: nuevo `getVisionModel(providerId, fallback)` — OCR con OpenAI/Gemini/Anthropic usa el modelo con capability `vision`/`ocr` configurado en la BD para ese provider, con el literal anterior solo como último recurso.
- **Bug real destapado por este cambio**: `hive-ui/pages/SetupPage.tsx` guardaba `sttProvider: "groq-whisper"` / `"openai-whisper"` como valores por defecto del wizard — ids que **nunca coincidían** con ningún modelo real (`voice/index.ts` esperaba `whisper-large-v3-turbo`/`whisper-1`), así que cualquier instalación nueva que aceptara el default del wizard tenía transcripción de voz rota desde el día uno. Corregido a los ids reales.
- **Fix relacionado en `storage/seed.ts`**: `seedAllData()` corre en **cada arranque** y borra + reinserta `models` con `PRAGMA foreign_keys = OFF` (para no romper por agentes que referencian filas viejas). Eso significa que cualquier agente apuntando a un modelo que sale del catálogo entre versiones — como las 8 variantes GGUF de HiveAgents retiradas en esta misma release — quedaba con un `agents.model_id` colgante que ninguna migración limpiaba. Se agregó un `UPDATE agents SET model_id = NULL WHERE model_id NOT IN (SELECT id FROM models)` justo después del re-seed de modelos, para que sea un invariante que se autorepara en cada boot (no solo para este caso puntual). Verificado con `tests/seed-dangling-model.test.ts`.

---

## Voz (STT/TTS): Resolución Basada en Base de Datos

Antes, `VoiceService.transcribe()`/`speak()` adivinaban el provider por prefijos del `modelId` (`modelId.startsWith("whisper")`, `"eleven"`, `"tts-"`...) y **caían silenciosamente a Groq/ElevenLabs** ante cualquier modelo no reconocido — un fallback peligroso que podía enrutar audio al provider equivocado sin avisar.

- `packages/core/src/voice/index.ts`: nuevo `getModelProvider()` resuelve el provider real desde las tablas `models`/`providers`; si el modelo no está en la BD, cae a `getFirstActiveVoiceModel()` (primer modelo STT/TTS activo) con warning explícito en logs; si no hay ningún modelo activo del tipo pedido, lanza error claro en vez de adivinar.
- `packages/core/src/gateway/routes/voice.ts`: la lista de providers de voz ya no es un array hardcodeado — se deriva de qué providers tienen modelos `stt`/`tts` en la BD (`getVoiceProviderIds()`); providers locales (Piper, por capability `"local"`) se detectan por BD en vez de estar hardcodeados como siempre-configurados.
- Nuevo campo `category` en `providers` (`'llm' | 'stt' | 'tts'`) — seed.ts marca `elevenlabs`/`piper` como `'tts'` (migración `v0.0.41` corrige los ya existentes).
- `packages/hive-ui/src/types/providers.ts`: `Provider.category` expuesto al frontend.

---

## UI: Reorganización de Providers

- `ProvidersPage.tsx`: la pestaña "Texto" (que mezclaba providers LLM con el downloader de modelos locales) se elimina; queda una pestaña "Providers" genérica filtrada por `category === 'llm'` (`ProviderList.tsx`).
- `ChannelConfigDialog.tsx`, `VoiceProvidersPanel.tsx`, `VoiceProvidersTab.tsx`: actualizados a la resolución de providers de voz basada en BD.
- Nuevo `packages/hive-ui/src/lib/capabilities.ts`: `parseCapabilities()` extraído como helper compartido (antes duplicado en `VisionModelsTab.tsx` y otros).

---

## Otros Cambios

- `packages/core/package.json`: nueva dependencia `@johpaz/hive-db`, bumpeada durante la versión de `^0.2.0` a `^0.3.1` (ver "Harness Causal G9" más abajo).
- `packages/hive-ui/src/lib/constants.ts`: removida constante `DEFAULT_MODEL = "gpt-4"` sin uso.
- `bun.lock`: `@johpaz/hive-agents-mcp`/`@johpaz/hive-agents-skills`/`@johpaz/hive-agents-core` de `workspace:*` a versión fijada del monorepo — bug real destapado al final de la versión: los rangos habían quedado en `^0.0.40` mientras el monorepo ya estaba en `0.0.41`, y con paquetes `0.0.x` el caret no flota entre patches, así que `bun install` fallaba por completo (caía a buscar los paquetes internos en el registro público, donde no existen). Corregido a `^0.0.41`.
- `docs/DOCUMENTO-EXPLICATIVO-COMPONENTES.md`: referencias a `local-llama`/`LocalLLMCard`/`/api/llm-local` retiradas (consistente con la remoción del provider).
- `docs/AGENT_FORM_FILL_EVAL.md` eliminado (el test `tests/agent-form-fill-eval.test.ts` y su fixture siguen intactos, solo se retiró la doc standalone — sin otras referencias en el repo).
- `CHANGELOG_v0.0.39.md` eliminado del repo — no se encontró la razón en el diff ni referencias rotas resultantes; si fue accidental, avisar para restaurarlo desde `git show 83527d8:CHANGELOG_v0.0.39.md`.
