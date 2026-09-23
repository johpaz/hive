/**
 * Los turnos que BIA encola deben ir al lane de la conversación, como el chat
 * escrito. Caso real (2026-09-02): el pedido de voz fue al lane del sessionId
 * (job 194) mientras Bee trabajaba en `…/webchat/conv-…`; el resultado de lo
 * delegado volvió al lane de la conversación (job 195) y la voz, que vigilaba
 * el otro lane, nunca lo narró. Además, voz y texto del mismo hilo podían
 * correr en paralelo.
 */
process.env.HIVE_DB_PATH = ":memory:"

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { ensureHiveDb } from "../packages/core/src/storage/bootstrap"
import { closeHiveDb } from "../packages/core/src/storage/hivedb"
import { col } from "../packages/core/src/storage/hive"
import type { AgentDoc, JobDoc, NarrationEventDoc, TaskDoc } from "../packages/core/src/storage/collections"
import { CONSULT_TOOL, STATUS_TOOL, executeBridgeTool, olvidarPeticiones } from "../packages/core/src/gateway/realtime/bridge-tools"
import { createRun } from "../packages/core/src/agent/run-store"
import { toIndexable } from "../packages/core/src/storage/hive"
import { emitCanvas } from "../packages/core/src/canvas/emitter"
import { initDurableQueue } from "../packages/core/src/gateway/durable-queue"

const sessionId = "user-1"
const threadId = "user-1/webchat/conv-abc"

beforeEach(async () => {
  closeHiveDb()
  await ensureHiveDb()
  // No executors: the job stays pending, which is all this test inspects.
  initDurableQueue({ maxGlobalConcurrency: 0 })
  olvidarPeticiones(sessionId)
})
afterEach(() => closeHiveDb())

describe("voice bridge lane", () => {
  test("consultar_a_bee queues on the conversation lane with its thread", async () => {
    let alive = true
    const result = await executeBridgeTool(CONSULT_TOOL, { peticion: "Lista los archivos del workspace" }, {
      sessionId, threadId, userId: "user-1", speak: () => {}, isAlive: () => alive,
    })
    alive = false // stop the follow-up loop
    expect(result.ok).toBe(true)

    const jobs = (await (await col<JobDoc>("jobQueue")).scan({})).map(e => e.doc)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].lane).toBe(threadId)
    const payload = JSON.parse(jobs[0].payload_json)
    expect(payload).toMatchObject({ source: "realtime", sessionId, threadId, userId: "user-1" })
  })

  test("estado_de_la_colmena tells BIA who is doing what, what finished and the latest steps", async () => {
    const agents = await col<AgentDoc>("agents")
    const agent = (id: string, name: string, role: "coordinator" | "worker") => ({
      id, user_id: "user-1", name, description: null, system_prompt: null, tone: null, role, status: "idle",
      enabled: true, provider_id: toIndexable(null), model_id: toIndexable(null), tools_json: null, skills_json: null,
      parent_id: toIndexable(null), max_iterations: 5, workspace: null, lastTraceAt: null, created_at: 1, updated_at: 1,
    }) as AgentDoc
    await agents.put("bee-test", agent("bee-test", "Bee", "coordinator"))
    await agents.put("mailer-test", agent("mailer-test", "Especialista de correo", "worker"))
    await agents.put("files-test", agent("files-test", "Operador de archivos", "worker"))

    const run = await createRun({ thread_id: threadId, agent_id: "bee-test", user_id: "user-1", channel: "webchat", kind: "chat", max_iterations: 5 })
    const now = Date.now()
    const task = (id: string, agentId: string, status: TaskDoc["status"], extra: Partial<TaskDoc> = {}) => ({
      id, agent_id: toIndexable(agentId), name: id, description: null, status, progress: 0, result: null, error: null,
      metadata: null, job_id: null, run_id: run.id, thread_id: threadId, started_at: now, attempts: 1,
      created_at: now, updated_at: now, completed_at: null, ...extra,
    }) as TaskDoc
    const tasks = await col<TaskDoc>("tasks")
    await tasks.put("enviar correo", task("enviar correo", "mailer-test", "in_progress"))
    await tasks.put("crear archivo", task("crear archivo", "files-test", "completed", { result: "Archivo notas.txt creado y verificado." }))

    // The same live state the 3D office draws.
    emitCanvas("canvas:node_update", { nodeId: "mailer-test", changes: { status: "tool_call", currentTool: "email__enviarEmail" } })
    emitCanvas("canvas:node_update", { nodeId: "bee-test", changes: { status: "thinking", currentTool: null } })

    const events = await col<NarrationEventDoc>("narrationEvents")
    await events.put("n1", {
      id: "n1", turn_id: "t", thread_id: threadId, channel: "webchat", user_id: "user-1", session_id: sessionId,
      agent_id: "mailer-test", agent_name: "Especialista de correo", kind: "tool_call", status: "running",
      label: "Enviando el correo", detail: null, dedupe_key: "n1", created_at: now,
    })

    const status = await executeBridgeTool(STATUS_TOOL, {}, { sessionId, threadId, userId: "user-1", speak: () => {}, isAlive: () => false }) as any
    expect(status.ok).toBe(true)
    expect(status.bee.estado).toBe("pensando")
    expect(status.tareas).toEqual([expect.objectContaining({ tarea: "enviar correo", especialista: "Especialista de correo", herramienta_actual: "email__enviarEmail" })])
    expect(status.terminadas_recientes).toEqual([expect.objectContaining({ tarea: "crear archivo", resultado: "completada", resumen: "Archivo notas.txt creado y verificado." })])
    expect(status.ultimos_pasos[0]).toMatchObject({ agente: "Especialista de correo", paso: "Enviando el correo" })

    emitCanvas("canvas:node_update", { nodeId: "mailer-test", changes: { status: "idle", currentTool: null } })
    emitCanvas("canvas:node_update", { nodeId: "bee-test", changes: { status: "idle" } })
  })
})
