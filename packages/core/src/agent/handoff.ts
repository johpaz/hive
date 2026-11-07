/**
 * Handoff — el estado de una conversación compactada, en seis campos.
 *
 * Reemplaza al resumen de "3–5 oraciones": ese formato pierde justo lo que
 * hace falta para continuar (rutas, valores exactos, errores, qué ya falló).
 * El traspaso estructurado sigue el de "You don't need long context"
 * (arXiv 2611.05306, apéndice A): objetivo, hechos establecidos, cambios
 * aplicados, verificación, callejones sin salida y plan restante.
 *
 * Todo aquí es puro (sin LLM ni base de datos) para poder probarlo aislado.
 */

export interface Handoff {
  /** Una línea: el resultado que se busca. */
  objective: string
  /** Hechos verificados: rutas, valores, ids, errores, preferencias del usuario. */
  facts: string[]
  /** Qué se cambió o creó, y si se verificó. */
  changes: string[]
  /** Comprobaciones hechas y su resultado. */
  verification: string[]
  /** Enfoques que fallaron y no deben repetirse. */
  dead_ends: string[]
  /** Subtareas pendientes en orden; la primera es el siguiente paso. */
  plan: string[]
}

const MAX_ITEMS = 30
const MAX_ITEM_CHARS = 500
const MAX_OBJECTIVE_CHARS = 400

export const HANDOFF_SYSTEM_PROMPT =
  "You are a conversation state compactor. You write a handoff so that another instance of the " +
  "assistant, seeing ONLY your handoff plus the latest messages, can continue the work without " +
  "asking again or repeating what already failed. Answer with a single JSON object and nothing else."

/** El prompt de usuario: transcripción nueva y, si la hay, el traspaso anterior a incorporar. */
export function buildHandoffPrompt(input: {
  transcript: string
  messageCount: number
  /** Traspaso (o resumen libre) de la compactación anterior del mismo hilo. */
  previous?: string | null
}): string {
  const previous = input.previous?.trim()
  return [
    previous
      ? `Previous handoff (carry forward what is still true; drop what is obsolete):\n${previous}\n`
      : "",
    `New conversation to fold in (${input.messageCount} messages):\n${input.transcript}\n`,
    "Reply with ONLY this JSON object (same language as the conversation; one short line per item):",
    "{",
    '  "objective": "one line: the result the user wants",',
    '  "facts": ["established facts, kept EXACT: paths, ids, values, names, errors, user preferences and decisions"],',
    '  "changes": ["what was changed or created, and whether it was verified"],',
    '  "verification": ["checks run and their outcome"],',
    '  "dead_ends": ["approaches that failed and must not be repeated, with why"],',
    '  "plan": ["remaining steps in order; the first is the immediate next step"]',
    "}",
    "Rules:",
    "- facts: keep EXACT, character for character, every value the user or a tool DECLARED as configuration or requirement: " +
      "limits, endpoints, URLs, tokens, ids, file paths, names, versions and preferences. If a similar value appears elsewhere " +
      "(another environment, a free-tier limit, an example), keep both and say which is which.",
    "- Do not spend facts on incidental output that does not matter for the next step: timings, test counts, commit hashes, unchanged-file reports.",
    "- dead_ends: every approach that failed, with its error or reason, so nobody tries it again.",
    "- Carry forward everything still true from the previous handoff; never drop a fact just to make room.",
    "Use [] for a field with nothing to report. Never invent facts; separate what was observed from what is only an idea.",
  ].filter(Boolean).join("\n")
}

function clean(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value)
  return text.replace(/\s+/g, " ").trim().slice(0, max)
}

function cleanList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" && value.trim() ? [value] : []
  return items.map((item) => clean(item, MAX_ITEM_CHARS)).filter(Boolean).slice(0, MAX_ITEMS)
}

/** El objeto JSON dentro de la respuesta del modelo (con o sin cercas de código). */
function extractJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * Lee la respuesta del modelo como traspaso. `null` si no es JSON o no trae
 * nada útil (ni objetivo, ni hechos, ni plan): el llamador decide qué hacer.
 */
export function parseHandoff(raw: string): Handoff | null {
  const data = extractJson(raw)
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const o = data as Record<string, unknown>
  const handoff: Handoff = {
    objective: clean(o.objective, MAX_OBJECTIVE_CHARS),
    facts: cleanList(o.facts),
    changes: cleanList(o.changes),
    verification: cleanList(o.verification),
    dead_ends: cleanList(o.dead_ends),
    plan: cleanList(o.plan),
  }
  if (!handoff.objective && handoff.facts.length === 0 && handoff.plan.length === 0) return null
  return handoff
}

/**
 * El traspaso como texto para el prompt. El orden es el de prioridad: quien
 * recorte la cola (el compilador de contexto corta al llegar a su tope) pierde
 * primero la verificación y los cambios, y último los hechos.
 */
export function renderHandoff(h: Handoff): string {
  const list = (title: string, items: string[]) =>
    items.length ? `${title}:\n${items.map((i) => `- ${i}`).join("\n")}` : ""
  return [
    h.objective ? `Objetivo: ${h.objective}` : "",
    list("Hechos establecidos", h.facts),
    list("Callejones sin salida (no repetir)", h.dead_ends),
    list("Plan restante", h.plan),
    list("Cambios aplicados", h.changes),
    list("Verificación", h.verification),
  ].filter(Boolean).join("\n\n")
}
