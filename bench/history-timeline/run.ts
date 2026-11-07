#!/usr/bin/env bun
/**
 * Benchmark de la línea de tiempo del historial (HIVE_HISTORY_TIMELINE): ¿cuánto de lo plantado fuera de
 * ventana llega, literal, al system prompt que compila `compileContext`? Sin modelo, sin red, determinista.
 *
 *   bun bench/history-timeline/run.ts [--seeds 3] [--out resultados.json]
 *
 * Reutiliza los escenarios y la puntuación de bench/compaction (datos plantados entre relleno con señuelos).
 * Tres tipos de consulta (el primero está saturado: la búsqueda actual ya acierta cuando la pregunta comparte
 * palabras con el dato, así que no distingue modos; se mantiene como control):
 *   A · la pregunta natural de cada dato · B · una consulta vaga sin palabras del dato · C · UNA consulta que
 * pide todo a la vez («resume todo lo acordado»), donde importa cuánto cabe en el presupuesto.
 * Compara el modo actual (recuperación fija de 3 × 500) con el
 * nuevo, para varias ventanas de contexto (el presupuesto de ambos escala con ella).
 *
 * Qué mide: si el dato está EN el contexto. No mide si el agente lo usa bien ni la ayuda de `conversation_read`.
 */

process.env.HIVE_DB_PATH = ":memory:"
// Estos bancos miden el mecanismo con cualquier ventana: sin la compuerta por tamaño.
process.env.HIVE_HISTORY_TIMELINE_MIN_WINDOW = "0"

import { writeFileSync } from "node:fs"
const { closeHiveDb } = await import("../../packages/core/src/storage/hivedb")
const { ensureHiveDb } = await import("../../packages/core/src/storage/bootstrap")
const { resetBootId } = await import("../../packages/core/src/storage/boot-id")
const { col, toIndexable } = await import("../../packages/core/src/storage/hive")
const { addMessage, getHistory } = await import("../../packages/core/src/agent/conversation-store")
const { indexThreadMessages } = await import("../../packages/core/src/agent/message-memory")
const { compileContext } = await import("../../packages/core/src/agent/context-compiler")
const { buildScenario } = await import("../compaction/scenario")
const { hasAll } = await import("../compaction/score")

const WINDOW = 15 // KEEP_LAST_N_MESSAGES
const CONTEXT_WINDOWS = [8_000, 32_000, 128_000] // la compuerta por tamaño está desactivada en este banco

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const seeds = Array.from({ length: Number(arg("seeds") ?? 3) }, (_, i) => i + 1)

async function seedAgent(contextWindow: number) {
  await (await col<any>("users")).put("u", {
    id: "u", name: "U", language: "es", timezone: null, occupation: null, notes: null, master_key_hash: null,
    email: null, password_hash: null, preferred_cron_channel: "webchat", created_at: Date.now(),
  })
  await (await col<any>("agents")).put("a", {
    id: "a", user_id: "u", name: "A", description: null, system_prompt: "Agente de prueba.", tone: null,
    role: "coordinator", status: "idle", enabled: true, provider_id: toIndexable("p"), model_id: toIndexable("m"),
    tools_json: null, skills_json: null, parent_id: toIndexable(null), max_iterations: 10, workspace: null,
    lastTraceAt: null, created_at: Date.now(), updated_at: Date.now(),
  })
  await (await col<any>("providers")).put("p", {
    id: "p", name: "P", enabled: true, active: true, base_url: "https://fake.invalid/v1", category: "llm",
    num_ctx: null, num_gpu: 0, created_at: Date.now(),
  })
  await (await col<any>("models")).put("m", {
    id: "m", provider_id: "p", name: "M", model_type: "llm", active: true, enabled: true,
    context_window: contextWindow, capabilities: null,
  })
}

interface Cell { retained: number; considered: number; promptChars: number }
interface Cells { A: Cell; B: Cell; C: Cell }

const VAGUE = "retoma lo que habíamos acordado antes, por favor"

/** `actual` = sin flag; el resto activa el flag con esa(s) pieza(s): ablación para saber de dónde viene la mejora. */
type Mode = "actual" | "solo-recuperacion" | "solo-linea" | "ambas"
const MODES: Mode[] = ["actual", "solo-recuperacion", "solo-linea", "ambas"]
const PARTS: Record<Exclude<Mode, "actual">, string> = { "solo-recuperacion": "recall", "solo-linea": "timeline", ambas: "both" }

async function run(seed: number, contextWindow: number, mode: Mode): Promise<Cells> {
  if (mode !== "actual") {
    process.env.HIVE_HISTORY_TIMELINE = "true"
    process.env.HIVE_HISTORY_TIMELINE_PARTS = PARTS[mode]
  } else {
    delete process.env.HIVE_HISTORY_TIMELINE
    delete process.env.HIVE_HISTORY_TIMELINE_PARTS
  }
  closeHiveDb(); resetBootId(); await ensureHiveDb(); await seedAgent(contextWindow)

  const scenario = buildScenario(seed)
  const threadId = `bench-${seed}-${contextWindow}-${mode}`
  for (const m of scenario.messages) await addMessage(threadId, m.role, m.content)
  await indexThreadMessages(threadId, await getHistory(threadId, 10_000))

  const outside = scenario.items.filter((it) => it.messageIndex < scenario.messages.length - WINDOW)

  // A · una consulta por dato.
  let retainedA = 0, charsA = 0
  for (const item of outside) {
    const ctx = await compileContext({ agentId: "a", threadId, userMessage: item.question })
    if (hasAll(ctx.systemPrompt, item.expect)) retainedA++
    charsA += ctx.systemPrompt.length
  }
  // B · una consulta vaga; se mira cuántos datos hay en ese único prompt.
  const vague = await compileContext({ agentId: "a", threadId, userMessage: VAGUE })
  // C · una consulta que pide todo a la vez.
  const all = await compileContext({
    agentId: "a", threadId,
    userMessage: "Resume todo lo que acordamos: " + outside.map((i) => i.question).join(" "),
  })
  const count = (prompt: string) => outside.filter((it) => hasAll(prompt, it.expect)).length
  return {
    A: { retained: retainedA, considered: outside.length, promptChars: Math.round(charsA / Math.max(1, outside.length)) },
    B: { retained: count(vague.systemPrompt), considered: outside.length, promptChars: vague.systemPrompt.length },
    C: { retained: count(all.systemPrompt), considered: outside.length, promptChars: all.systemPrompt.length },
  }
}

type Kind = "A" | "B" | "C"
const results: Array<{ contextWindow: number; mode: Mode; kind: Kind; rate: number; avgPromptChars: number }> = []
console.log(`Escenarios: semillas ${seeds.join(",")} · ventana de mensajes ${WINDOW} · datos plantados fuera de ventana\n`)
console.log(`${"ventana".padEnd(8)} ${"modo".padEnd(18)} ${"consulta".padEnd(9)} ${"retenidos".padStart(10)} ${"tasa".padStart(6)} ${"chars de prompt (medio)".padStart(24)}`)
for (const cw of CONTEXT_WINDOWS) {
  for (const kind of ["A", "B", "C"] as Kind[]) {
    for (const mode of MODES) {
      let retained = 0, considered = 0, chars = 0
      for (const seed of seeds) {
        const c = (await run(seed, cw, mode))[kind]
        retained += c.retained; considered += c.considered; chars += c.promptChars
      }
      const rate = considered ? retained / considered : 0
      const avg = Math.round(chars / seeds.length)
      results.push({ contextWindow: cw, mode, kind, rate, avgPromptChars: avg })
      console.log(`${String(cw).padEnd(8)} ${mode.padEnd(18)} ${kind.padEnd(9)} ${`${retained}/${considered}`.padStart(10)} ${`${(rate * 100).toFixed(0)}%`.padStart(6)} ${String(avg).padStart(24)}`)
    }
  }
}
closeHiveDb()
const out = arg("out")
if (out) writeFileSync(out, JSON.stringify(results, null, 2))
// Algún manejador abierto de la base impide que el proceso salga solo.
process.exit(0)
