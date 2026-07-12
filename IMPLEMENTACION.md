# Hive: Harness de Tareas de Larga Duración — Documento de Implementación

**Fecha:** 2026-07-11
**Versión del plan:** PLAN.md v1 + revisión posterior
**Estado:** Implementado y verificado (55 tests del harness + 45 adyacentes en verde, typecheck limpio, smoke de boot con crash simulado)

---

## 1. Resumen Ejecutivo

Hive ahora tiene un harness de tareas de larga duración: el agent loop pasó de
ser un sistema interactivo de turnos cortos a un runner durable con
checkpoints, cola persistente y recuperación automática tras crash.

- **Checkpoints** serializados en HiveDB (colección `agentRuns`) con leases por `boot_id`
- **Cola durable** (`jobQueue`) con prioridad, concurrencia global, re-dispatch al boot y cancel real de jobs corriendo
- **Chat durable**: los 5 caminos de chat (WS message/audio/a2ui/canvas + API HTTP) encolan jobs `chat_turn`; un turno interrumpido por crash se re-ejecuta al reiniciar y responde por el canal
- **Presupuestos duros** (iteraciones/turnos/tokens) por run
- **Metas verificables**: `/goal` orquesta turnos con verificación (tool determinística o LLM) hasta cumplir la meta o agotar presupuesto
- **Delegación asíncrona** (`task_delegate mode=async`) con workers que checkpointean y reanudan a mitad de tarea
- **Motor de proyectos/tareas** con grafo de dependencias (claim OCC, sin dobles encolados)
- **Catch-up de cron**: one-shots perdidos se disparan dentro de la gracia o quedan `failed`; nunca zombies
- **Quick wins**: timeouts por tool, WS heartbeat 30s, retención 500/thread, circuit breakers expuestos en `/health`

### Nota de honestidad histórica

Una versión anterior de este documento declaraba "las 7 fases completas".
La revisión encontró que la Fase 2 (chat durable) no estaba cableada, la
Fase 3 (goal continuation) era un placeholder y había 7 bugs de durabilidad
(ver §5). Todo eso se corrigió en los commits de esta rama. El error de
TypeScript por import duplicado de `Config` en `tool-runtime/index.ts` fue
introducido por la implementación base (no era preexistente) y está corregido;
los únicos errores de tsc restantes son los 2 preexistentes reales
(`packages/cli/src/commands/gateway.ts:255` y `tests/captcha.test.ts:7`).

---

## 2. Restricciones de Diseño

| Restricción | Solución |
|-------------|----------|
| HiveDB solo admite 1 proceso con la BD abierta | Al boot, TODA fila "running" pertenece a un proceso muerto → reconcile repara de inmediato sin esperar leases; los leases quedan como respaldo en runtime |
| Callbacks no serializables (ws.send, onToken) | `webchat-turn.ts`: payload 100% serializable + stash en memoria de `sendRaw`; sin callbacks el turno corre headless y entrega por el canal |
| Chat interactivo no debe degradarse | Los jobs `chat_turn` NO cuentan contra `maxGlobalConcurrency` (workers ocupados no congelan el webchat); 1 job corriendo por lane preserva la semántica de LaneQueue |
| OCC en HiveDB | `expectedVersion` en claims de jobs y tasks (pending→queued) |

---

## 3. Arquitectura

```
             server.ts boot (solo fuera de setup mode)
  reconcileOnBoot → initJobExecutors → initDurableQueue → initWebchatTurnRunner
                  → initTaskDriver → CronScheduler.boot()
                                 │
        ┌────────────────────────┼─────────────────────────┐
        ▼                        ▼                          ▼
  CronScheduler          DurableLaneQueue              TaskDriver
  (misfire catch-up)     (re-dispatch pending al boot, (grafo deps,
                          cancel aborta running,        claim OCC
                          chat bypass del cap global)   pending→queued)
                                 │
                       jobQueue (HiveDB, claim OCC + lease)
                                 │
   ┌──────────────┬──────────────┼──────────────┐
   ▼              ▼              ▼              ▼
 chat_turn    worker_task   project_task     goal_run
 (runWebchat  (isolated +   (isolated +     (multi-turno:
  Turn: live/  checkpoint/   checkpoint/     turno → verifyGoal
  headless)    resume)       resume)         → continuar/fail)
                                 │
                        agentRuns (HiveDB)
        state_json + pending_tool_calls_json + lease boot_id
```

### Flujo crash → resume

1. Pre-tool checkpoint persiste `pending_tool_calls_json`; post-tool lo limpia.
2. `kill -9` / crash.
3. Boot: `reconcileOnBoot` — todo run/job "running" es huérfano (proceso único):
   runs chat → `interrupted` + aviso al canal; jobs → `pending` (attempts+1) o
   `interrupted` si agotó intentos; tasks `queued`/`in_progress` sin job vivo →
   `pending`/`failed`.
4. `DurableLaneQueue.start()` re-despacha TODOS los jobs pending.
5. El ejecutor decide `resume` mirando el checkpoint real (`state_json`), no el
   payload; la tool en vuelo reaparece como mensaje sintético `[interrupted]`.
6. Sin socket vivo, la respuesta final sale por `sendToUserChannel`.

### Finalización garantizada del run

`runAgent` envuelve el loop en try/catch/finally: excepción → `failRun` +
lease liberado; abandono del generator (break del consumidor) → `interrupted`
con checkpoint preservado; `reclaimRun` restaura `status: "running"` +
`boot_id` al re-ejecutar (el renovador de lease se auto-detiene si el status
no es "running").

---

## 4. Archivos

**Nuevos:** `storage/boot-id.ts`, `storage/reconcile.ts`, `agent/run-store.ts`,
`agent/goal-runner.ts`, `gateway/job-store.ts`, `gateway/durable-queue.ts`,
`gateway/job-executors.ts`, `gateway/webchat-turn.ts`,
`scheduler/task-driver.ts`, `tools/projects/index.ts`.

**Modificados:** `agent/agent-loop.ts` (checkpoint/resume/budget + try/finally +
passthrough en `AgentLoop.stream` y `runAgentIsolated`),
`agent/providers/index.ts` (opciones durables en `generate`),
`gateway/server.ts` (boot wiring, 4 call sites WS → `enqueueChatTurn`, cancel →
`cancelLane`, SIGTERM, WS heartbeat, `/health`), `gateway/routes/chat.ts`
(espera sobre el JobDoc), `gateway/slash-commands.ts` (`/goal`),
`scheduler/CronScheduler.ts` (misfire), `storage/collections.ts` +
`bootstrap.ts` (`AgentRunDoc`, `JobDoc`, `TaskDoc.queued`, índices),
`tools/agents/index.ts` (`task_delegate` async, `task_status` real),
`tool-runtime/index.ts` (timeouts por tool), `config/loader.ts`
(`tools.timeouts`).

---

## 5. Bugs corregidos tras la revisión

1. Excepción del LLM dejaba el run "running" con lease renovándose para siempre (sin try/finally; `failRun` importado pero nunca llamado).
2. Los jobs `pending` de un boot anterior nunca se despachaban.
3. Reclaim esperaba leases de 30 min (jobs) / 2 min (runs) aunque el proceso es único; un reinicio rápido dejaba runs huérfanos para siempre.
4. `resume` venía del payload (siempre false en un reclaim) → el checkpoint nunca se usaba; además el run reanudado quedaba "interrupted" y el lease no se renovaba.
5. El TaskDriver encolaba sin claim OCC → el poll de 10s duplicaba jobs.
6. Import duplicado de `Config` (error TS introducido).
7. One-shot de cron perdido fuera de gracia quedaba "active" para siempre.

Gaps completados: cableado real de `chat_turn` (antes ningún caller), goal
continuation multi-turno (antes placeholder; `verifyGoal` corría el check tool
con `allTools: []` y usaba `includes("true")`), notificación post-crash por
canal, checkpoints en workers, tool `task_complete` + kick inmediato del
driver.

---

## 6. Verificación

```
bun test tests/run-store.test.ts tests/job-store.test.ts \
  tests/agent-loop-resume.test.ts tests/retention-cap.test.ts \
  tests/agent-loop-integration.test.ts tests/durable-queue.test.ts \
  tests/goal-runner.test.ts tests/cron-misfire.test.ts \
  tests/task-driver.test.ts tests/agent-loop-failure.test.ts
→ 55 pass, 0 fail (10 archivos)

bun test tests/chat-route.test.ts tests/core.test.ts \
  tests/hive-helpers.test.ts tests/seed-data.test.ts
→ 45 pass, 0 fail

npx tsc --noEmit → solo los 2 errores preexistentes conocidos
```

Smoke de boot: gateway arrancado en HIVE_HOME aislado, SIGKILL a los 20s
(crash simulado), segundo boot sobre la BD sucia arranca limpio.

**Pendiente manual (requiere entorno configurado):** turno de webchat real con
streaming + stop, `kill -9` con un worker en vuelo y verificación visual del
resume — los equivalentes están cubiertos por tests unitarios/integración.

---

## 7. Configuración

```yaml
tools:
  timeouts:
    cli_exec: 330000        # timeout por tool (ms)

# CronJob
misfire_policy: "skip"      # "skip" | "fire_once"
misfire_grace_min: 60
```

`/goal <meta> [--tries N] [--check-tool tool]` — encola un goal run asíncrono.

## 8. Limitaciones conocidas

- Los turnos de una meta (`goal_run`) no checkpointean intra-turno: un crash a
  mitad de turno re-ejecuta ese intento completo (el historial del thread
  preserva el progreso previo).
- El payload de un `chat_turn` multimodal guarda la imagen/documento en base64
  dentro de `payload_json` (limpiado por la retención de 500 jobs/run).
- Un turno del API HTTP recuperado tras crash responde por el canal webchat;
  el cliente HTTP original ya no recibe esa respuesta (recibió 504).
