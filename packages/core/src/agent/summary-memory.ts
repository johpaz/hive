/**
 * Memoria entre hilos — los resúmenes de compactación, indexados en HiveDB.
 *
 * Cada hilo tiene UN resumen acumulativo (cada compactación incorpora el
 * anterior), así que no hay resúmenes viejos que recuperar dentro del mismo
 * hilo. Lo que sí aporta el índice es encontrar, por relevancia, lo hablado en
 * OTROS hilos.
 *
 * Convención (mismo índice que capability-search): id `summary:<threadId>`,
 * filtros `type=summary` y `thread`. `searchCapabilities` siempre filtra por
 * `type`, así que no ve estos documentos.
 *
 * Portado de hive-sdk sin la capa de inquilinos: hive es de un solo usuario.
 */

import { getHiveDb } from "../storage/hivedb"
import { getSummary } from "./conversation-store"
import { loadConfig } from "../config/loader"
import { logger } from "../utils/logger"

const log = logger.child("summary-memory")

const TYPE = "summary"
const DEFAULT_K = 3
const QUERY_MAX_CHARS = 500
const BODY_MAX_CHARS = 4000

export interface RelatedSummary {
  threadId: string
  summary: string
  score: number
}

export function crossThreadRecallEnabled(): boolean {
  return !!loadConfig().memory?.crossThreadRecall?.enabled
}

function docId(threadId: string): string {
  return `${TYPE}:${threadId}`
}

/** Indexa (o reemplaza) el resumen de un hilo. Nunca lanza: es memoria auxiliar. */
export async function indexThreadSummary(threadId: string, summary: string): Promise<void> {
  try {
    const db = await getHiveDb()
    await db.upsertDoc({
      id: docId(threadId),
      body: summary.slice(0, BODY_MAX_CHARS),
      filters: [
        { field: "type", value: TYPE },
        { field: "kind", value: "episode" },
        { field: "thread", value: threadId },
      ],
    })
  } catch (err) {
    log.warn(`[summary-memory] No se pudo indexar el resumen de ${threadId}: ${(err as Error).message}`)
  }
}

/** Quita el resumen de un hilo del índice (al borrar la conversación). */
export async function removeThreadSummary(threadId: string): Promise<void> {
  try {
    const db = await getHiveDb()
    await db.deleteDoc(docId(threadId))
  } catch (err) {
    log.warn(`[summary-memory] No se pudo quitar el resumen de ${threadId}: ${(err as Error).message}`)
  }
}

/** Resúmenes de otros hilos, por relevancia a `query`. */
export async function searchRelatedSummaries(
  query: string,
  excludeThreadId: string,
  k = loadConfig().memory?.crossThreadRecall?.k ?? DEFAULT_K,
): Promise<RelatedSummary[]> {
  const text = query.trim().slice(0, QUERY_MAX_CHARS)
  if (!text || k <= 0) return []
  try {
    const db = await getHiveDb()
    // +1: el hilo actual puede ocupar un puesto y se descarta después.
    const hits = await db.queryHybrid({
      text,
      k: k + 1,
      filters: [{ field: "type", value: TYPE }],
    })
    const prefix = `${TYPE}:`
    const out: RelatedSummary[] = []
    for (const hit of hits) {
      if (!hit.id.startsWith(prefix)) continue
      const threadId = hit.id.slice(prefix.length)
      if (threadId === excludeThreadId) continue
      // El índice solo devuelve ids: el texto vive en la colección `summaries`.
      // Si el hilo ya no tiene resumen, el documento del índice quedó huérfano.
      const stored = await getSummary(threadId)
      if (!stored) continue
      out.push({ threadId, summary: stored.summary, score: hit.score })
      if (out.length >= k) break
    }
    return out
  } catch (err) {
    log.warn(`[summary-memory] Búsqueda de resúmenes relacionados falló: ${(err as Error).message}`)
    return []
  }
}

/**
 * Episodios similares vía `buildAgentContext` (estrategia `episodicSimilarity`). El resumen de cada hilo
 * se indexa como episodio (`kind=episode`). Solo existe si el HiveDB instalado trae `embedQuery` y el
 * filtro del episodio: una versión anterior ignoraría el filtro y recorrería episodios ajenos, así que
 * sin esa función no se activa.
 */
export async function episodicStrategy(
  objective: string,
  k = loadConfig().memory?.crossThreadRecall?.k ?? DEFAULT_K,
): Promise<{ vector: Float32Array; k: number; filters: Array<{ field: string; value: string }> } | undefined> {
  const text = objective.trim().slice(0, QUERY_MAX_CHARS)
  if (!text || k <= 0) return undefined
  try {
    const db = await getHiveDb()
    // El HiveDB instalado puede ser anterior a embedQuery: se consulta por nombre.
    const embed = (db as unknown as { embedQuery?: (t: string) => Promise<Float32Array | undefined> }).embedQuery
    if (typeof embed !== "function") return undefined
    const vector = await embed.call(db, text)
    if (!vector) return undefined
    return { vector, k: k + 1, filters: [] }
  } catch (err) {
    log.warn(`[summary-memory] No se pudo preparar la similitud episódica: ${(err as Error).message}`)
    return undefined
  }
}

/** Convierte los episodios que devuelve el motor en resúmenes legibles, sin el hilo actual ni los ya usados. */
export async function resolveEpisodes(
  episodes: Array<{ taskId: string }>,
  excludeThreadIds: Iterable<string>,
  k = loadConfig().memory?.crossThreadRecall?.k ?? DEFAULT_K,
): Promise<RelatedSummary[]> {
  const exclude = new Set(excludeThreadIds)
  const prefix = `${TYPE}:`
  const out: RelatedSummary[] = []
  for (const episode of episodes) {
    const id = episode.taskId
    if (!id.startsWith(prefix)) continue
    const threadId = id.slice(prefix.length)
    if (exclude.has(threadId)) continue
    const stored = await getSummary(threadId)
    if (!stored) continue
    out.push({ threadId, summary: stored.summary, score: 0 })
    if (out.length >= k) break
  }
  return out
}
