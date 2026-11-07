/**
 * El modelo del benchmark: uno real (callLLM, con la clave en una variable de entorno) o uno
 * falso y determinista para comprobar que la tubería funciona sin red ni gasto.
 *
 * El modelo falso NO produce resultados interpretables: es extractivo y sirve solo para validar
 * que escenarios, variantes y puntuación están bien conectados.
 */

import { callLLM, resolveProviderConfig } from "../../packages/core/src/agent/llm-client"
import { closeHiveDb } from "../../packages/core/src/storage/hivedb"
import { HANDOFF_SYSTEM_PROMPT } from "../../packages/core/src/agent/handoff"
import { hasAll } from "./score"
import type { Llm } from "./variants"
import type { PlantedItem } from "./scenario"

export const PROBE_SYSTEM =
  "You are the next instance of an assistant that continues a task. You know ONLY what the summary says. " +
  "Answer each question briefly and exactly, copying exact values from the summary. " +
  "If the summary does not contain the answer, answer \"desconocido\". " +
  "Reply with ONLY a JSON object mapping each question id to its answer."

/**
 * El modelo tal como lo configuró hive: proveedor, URL y clave salen de `resolveProviderConfig`, es
 * decir, de su almacén de secretos (llave maestra en el llavero del SO). La clave nunca se imprime ni
 * se escribe en ningún sitio: pasa en memoria del almacén a la llamada.
 */
export async function hiveLlm(options: { provider: string; model: string }): Promise<{ llm: Llm; keyChars: number }> {
  const config = await resolveProviderConfig(options.provider, options.model)
  // callLLM no usa la base: se suelta ya para no bloquear `hive dev` durante una corrida larga.
  closeHiveDb()
  if (!config.apiKey) {
    throw new Error(
      `hive no tiene clave para el proveedor "${options.provider}". ` +
        `Arranca con el entorno donde la configuraste (p. ej. HIVE_HOME=$HOME/.hive-dev).`,
    )
  }
  const llm: Llm = async (system, user) => {
    const response = await callLLM({
      ...config,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })
    // Una llamada fallida devuelve el error como `content`: no es salida del modelo.
    if (response.stop_reason === "error") {
      throw new Error(response.error?.message ?? "LLM error")
    }
    return response.content
  }
  return { llm, keyChars: config.apiKey.length }
}

/** Extractivo y determinista. Solo valida la tubería. */
export function fakeLlm(): Llm {
  return async (system, user) => {
    if (system === HANDOFF_SYSTEM_PROMPT) {
      const facts = user
        .split("\n")
        .filter((l) => /https?:\/\/|[A-Z]{3}-\d{4}-|\d{3} peticiones|\.ts\b|Basic|abandonado|formal|SQLite|Postgres|Redis|nota cr/i.test(l))
        .slice(0, 30)
      return JSON.stringify({ objective: "tarea de prueba", facts, changes: [], verification: [], dead_ends: [], plan: [] })
    }
    if (system === PROBE_SYSTEM) {
      // Devuelve todo el resumen como respuesta: acierta si y solo si el resumen contiene el dato.
      const summary = user.slice(user.indexOf("Summary:") + 8, user.indexOf("Questions:"))
      const ids = [...user.matchAll(/^- (\w+):/gm)].map((m) => m[1]!)
      return JSON.stringify(Object.fromEntries(ids.map((id) => [id, summary])))
    }
    // Prompt anterior de «3–5 oraciones»: los primeros 600 caracteres de lo que se le dio.
    return user.slice(user.indexOf("\n\n") + 2).slice(0, 600)
  }
}

function extractJson(raw: string): Record<string, unknown> | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    return value && typeof value === "object" && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Prueba de preguntas: con SOLO el resumen delante, ¿responde bien? Devuelve, por dato, si la
 * respuesta contiene lo esperado. Una respuesta ausente o ilegible cuenta como fallo.
 */
export async function probe(
  llm: Llm,
  summary: string,
  items: PlantedItem[],
): Promise<(item: PlantedItem) => boolean> {
  if (items.length === 0) return () => false
  const questions = items.map((i) => `- ${i.id}: ${i.question}`).join("\n")
  const raw = await llm(PROBE_SYSTEM, `Summary:\n${summary}\n\nQuestions:\n${questions}`)
  const answers = extractJson(raw) ?? {}
  return (item) => {
    const answer = answers[item.id]
    return typeof answer === "string" && hasAll(answer, item.expect)
  }
}
