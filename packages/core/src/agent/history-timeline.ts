/**
 * Línea de tiempo del historial fuera de ventana + recuperación que llena el presupuesto.
 *
 * Idea tomada de FlexA-Mem (arXiv 2610.33274): el historial ya se guarda una sola vez (conversation-store)
 * y se indexa (message-memory); lo que faltaba es RENDERIZARLO en cada llamada como una línea de tiempo
 * compacta más el texto original de lo relevante, con una regla fija y sin modelo.
 *
 * Todo aquí es puro (sin I/O): recibe filas y presupuestos, devuelve texto. Así se prueba sin base de datos.
 * El contenido de los mensajes `tool` nunca entra en la línea de tiempo: puede llevar credenciales.
 */

import type { StoredMessage } from "./conversation-store"
import { estimateTokens } from "../utils/toon"

export const DEFAULT_LINE_CHARS = 80

export interface HistoryTimeline {
  /** Una línea por mensaje, en orden cronológico. Vacío si no hay nada que mostrar o el presupuesto no da. */
  text: string
  /** Ids de los mensajes con línea, en orden. */
  ids: number[]
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`
}

function toolNames(row: StoredMessage): string {
  if (row.role !== "assistant" || !row.tool_calls_json) return ""
  try {
    const calls = JSON.parse(row.tool_calls_json) as Array<{ function?: { name?: string } }>
    const names = calls.map((c) => c.function?.name).filter((n): n is string => !!n)
    return names.length > 0 ? ` → tools: ${names.join(", ")}` : ""
  } catch {
    return ""
  }
}

function renderLine(row: StoredMessage, lineChars: number): string {
  const text = oneLine(row.content ?? "", lineChars)
  return `#${row.id} [${row.role}] ${text}${toolNames(row)}`
}

/**
 * Una línea por mensaje (user/assistant) con el texto recortado. Si no caben todas en `budgetTokens`,
 * conserva la primera y la última y reparte el resto con paso fijo, para que se vea el arco completo en vez
 * de solo el principio. Determinista: mismas filas y presupuesto, mismo resultado.
 */
export function renderHistoryTimeline(
  rows: StoredMessage[],
  opts: { budgetTokens: number; lineChars?: number },
): HistoryTimeline {
  const lineChars = opts.lineChars ?? DEFAULT_LINE_CHARS
  const usable = rows
    .filter((r) => (r.role === "user" || r.role === "assistant") && (r.content ?? "").trim().length > 0)
    .sort((a, b) => a.id - b.id)
  if (usable.length === 0 || opts.budgetTokens <= 0) return { text: "", ids: [] }

  const lines = usable.map((r) => renderLine(r, lineChars))
  // +1 por el salto de línea.
  const costs = lines.map((l) => estimateTokens(l) + 1)
  const total = costs.reduce((a, b) => a + b, 0)

  let picked: number[]
  if (total <= opts.budgetTokens) {
    picked = usable.map((_, i) => i)
  } else {
    // Primero y último, luego paso fijo, luego el resto: se toma lo que quepa en ese orden de prioridad.
    const n = usable.length
    const order: number[] = [0, n - 1]
    const step = Math.max(1, Math.floor(n / 8))
    for (let i = step; i < n - 1; i += step) order.push(i)
    for (let i = 1; i < n - 1; i++) order.push(i)
    const seen = new Set<number>()
    const chosen: number[] = []
    let used = 0
    for (const i of order) {
      if (seen.has(i)) continue
      seen.add(i)
      if (used + costs[i]! <= opts.budgetTokens) {
        used += costs[i]!
        chosen.push(i)
      }
    }
    picked = chosen.sort((a, b) => a - b)
  }

  return {
    text: picked.map((i) => lines[i]!).join("\n"),
    ids: picked.map((i) => usable[i]!.id),
  }
}

export interface RecallHit {
  message: StoredMessage
  score: number
}

/**
 * Mensajes recuperados por búsqueda, del más relevante al menos, hasta agotar `budgetTokens`. Lo que no cabe
 * se SALTA (un mensaje largo no impide que entren los cortos que siguen). Excluye los ids de `excludeIds`
 * (la ventana y la línea de tiempo) y los repetidos. Devuelve en orden cronológico.
 */
export function packRecall(
  hits: RecallHit[],
  opts: { budgetTokens: number; maxCharsPerMessage: number; excludeIds?: Iterable<number> },
): StoredMessage[] {
  const exclude = new Set(opts.excludeIds ?? [])
  const chosen: StoredMessage[] = []
  let used = 0
  for (const hit of [...hits].sort((a, b) => b.score - a.score)) {
    const row = hit.message
    if (exclude.has(row.id)) continue
    if (row.role === "tool") continue
    const body = oneLine(row.content ?? "", opts.maxCharsPerMessage)
    if (!body) continue
    const cost = estimateTokens(`#${row.id} [${row.role}] ${body}`) + 2
    if (used + cost > opts.budgetTokens) continue
    used += cost
    exclude.add(row.id)
    chosen.push({ ...row, content: body })
  }
  return chosen.sort((a, b) => a.id - b.id)
}

/** Texto del bloque de recuperación, en el mismo formato que el actual. */
export function renderRecall(rows: StoredMessage[]): string {
  return rows.map((m) => `- #${m.id} [${m.role}] ${m.content}`).join("\n")
}

export const clampTokens = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.floor(value)))
