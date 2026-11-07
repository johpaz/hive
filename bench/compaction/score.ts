/**
 * Puntuación del benchmark de compactación.
 *
 * Retención literal: ¿el dato plantado aparece en el texto que verá la siguiente
 * instancia? Es determinista y no depende de un juez; mide si la información
 * sobrevivió, no si la tarea se resolvería. Se complementa con la prueba de
 * preguntas (probe), que comprueba que alguien con SOLO ese texto sabe responder.
 */

import type { ItemKind, PlantedItem } from "./scenario"

/** Minúsculas, sin tildes y con espacios colapsados: «Nota Crédito» == «nota credito». */
export function norm(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim()
}

/** Todos los grupos deben cumplirse (Y); en cada uno basta una alternativa (O). */
export function hasAll(text: string, expect: string[][]): boolean {
  const haystack = norm(text)
  return expect.every((group) => group.some((alt) => haystack.includes(norm(alt))))
}

export interface Retention {
  /** Datos que ya habían pasado por la compactación (los de la cola viva no cuentan). */
  considered: number
  retained: number
  rate: number
  byKind: Partial<Record<ItemKind, { considered: number; retained: number }>>
  /** Por tramo de origen: 0 es el más antiguo, el que más compactaciones sufrió. */
  bySegment: Record<number, { considered: number; retained: number }>
  perItem: Record<string, boolean>
}

/** Qué datos entran en la comparación: los que quedaron antes del último corte. */
export function consideredItems(items: PlantedItem[], finalCutIndex: number): PlantedItem[] {
  return items.filter((item) => item.messageIndex < finalCutIndex)
}

export function scoreRetention(
  summary: string,
  items: PlantedItem[],
  finalCutIndex: number,
  hasIt: (item: PlantedItem) => boolean = (item) => hasAll(summary, item.expect),
): Retention {
  const byKind: Retention["byKind"] = {}
  const bySegment: Retention["bySegment"] = {}
  const perItem: Record<string, boolean> = {}
  let retained = 0
  const considered = consideredItems(items, finalCutIndex)
  for (const item of considered) {
    const ok = hasIt(item)
    perItem[item.id] = ok
    if (ok) retained++
    const k = (byKind[item.kind] ??= { considered: 0, retained: 0 })
    k.considered++
    if (ok) k.retained++
    const s = (bySegment[item.segment] ??= { considered: 0, retained: 0 })
    s.considered++
    if (ok) s.retained++
  }
  return {
    considered: considered.length,
    retained,
    rate: considered.length ? retained / considered.length : 0,
    byKind,
    bySegment,
    perItem,
  }
}

export interface Aggregate {
  runs: number
  retention: number
  probe: number | null
  summaryTokens: number
  calls: number
  failures: number
  byKind: Partial<Record<ItemKind, number>>
  bySegment: Record<number, number>
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** Promedio entre semillas. Las tasas por tipo y tramo se calculan sobre el total de datos, no sobre el promedio de tasas. */
export function aggregate(
  runs: Array<{ retention: Retention; probe?: Retention; summaryTokens: number; calls: number; failures: number }>,
): Aggregate {
  const kinds: Partial<Record<ItemKind, { c: number; r: number }>> = {}
  const segs: Record<number, { c: number; r: number }> = {}
  for (const run of runs) {
    for (const [kind, v] of Object.entries(run.retention.byKind) as Array<[ItemKind, { considered: number; retained: number }]>) {
      const k = (kinds[kind] ??= { c: 0, r: 0 })
      k.c += v.considered
      k.r += v.retained
    }
    for (const [seg, v] of Object.entries(run.retention.bySegment)) {
      const s = (segs[Number(seg)] ??= { c: 0, r: 0 })
      s.c += v.considered
      s.r += v.retained
    }
  }
  const probes = runs.map((r) => r.probe?.rate).filter((x): x is number => x !== undefined)
  return {
    runs: runs.length,
    retention: mean(runs.map((r) => r.retention.rate)),
    probe: probes.length ? mean(probes) : null,
    summaryTokens: mean(runs.map((r) => r.summaryTokens)),
    calls: runs.reduce((a, r) => a + r.calls, 0),
    failures: runs.reduce((a, r) => a + r.failures, 0),
    byKind: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, v!.r / v!.c])) as Aggregate["byKind"],
    bySegment: Object.fromEntries(Object.entries(segs).map(([k, v]) => [k, v.r / v.c])),
  }
}
