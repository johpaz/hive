/**
 * Historial recuperable — los mensajes compactados, indexados en HiveDB.
 *
 * La compactación pierde información por diseño. El paper "You don't need long
 * context" (arXiv 2611.05306) lo resuelve guardando el historial completo y
 * dándole al agente lectura selectiva: lo que no cabe en el contexto se recupera
 * "bajo demanda". Esto es el índice de esa lectura: búsqueda híbrida (BM25 más
 * vectores) sobre los mensajes de UN hilo, para `conversation_read`.
 *
 * El índice solo guarda ids y texto para buscar; el mensaje completo vive en la
 * colección `conversations`, que sigue siendo la fuente de verdad.
 *
 * Convención (mismo índice que summary-memory y capability-search): id
 * `message:<threadId>:<seq>`, filtros `type=message` y `mthread`.
 * `searchCapabilities` siempre filtra por `type`, así que no los ve.
 * Portado de hive-sdk sin la capa de inquilinos: hive es de un solo usuario.
 */

import { getHiveDb } from "../storage/hivedb"
import { getMessagesByIds, type StoredMessage } from "./conversation-store"
import { logger } from "../utils/logger"

const log = logger.child("message-memory")

const TYPE = "message"
const BODY_MAX_CHARS = 2000
const TOOL_BODY_MAX_CHARS = 1000
const QUERY_MAX_CHARS = 500
const DEFAULT_K = 8

export interface MessageHit {
  message: StoredMessage
  score: number
}

function docId(threadId: string, seq: number): string {
  return `${TYPE}:${threadId}:${seq}`
}

/** Lo que vale la pena buscar: texto de personas y del asistente, y resultados de herramientas (acotados). */
function searchableBody(row: StoredMessage): string {
  const text = row.content?.trim() ?? ""
  if (!text) return ""
  return text.slice(0, row.role === "tool" ? TOOL_BODY_MAX_CHARS : BODY_MAX_CHARS)
}

/**
 * Indexa (o reemplaza) los mensajes dados de un hilo. Idempotente por id. Nunca
 * lanza: es memoria auxiliar y no debe romper la compactación.
 */
export async function indexThreadMessages(threadId: string, rows: StoredMessage[]): Promise<void> {
  try {
    const docs = rows
      .map((row) => ({ row, body: searchableBody(row) }))
      .filter(({ body }) => body.length > 0)
      .map(({ row, body }) => ({
        id: docId(threadId, row.id),
        body,
        filters: [
          { field: "type", value: TYPE },
          { field: "mthread", value: threadId },
        ],
      }))
    if (docs.length === 0) return
    const db = await getHiveDb()
    await db.upsertBatch(docs)
  } catch (err) {
    log.warn(`[message-memory] No se pudieron indexar los mensajes de ${threadId}: ${(err as Error).message}`)
  }
}

/** Mensajes más cortos que esto no aportan nada que buscar («ok», «sigue»). */
const MIN_INDEXED_CHARS = 24

/**
 * Indexa UN mensaje al guardarlo, en segundo plano. Así lo que sale de la ventana (los últimos 15 mensajes) ya
 * es recuperable aunque nunca se compacte con un modelo: la recuperación no depende de la compactación.
 * Idempotente por id; nunca lanza.
 */
export async function indexMessage(threadId: string, seq: number, role: StoredMessage["role"], content: string): Promise<void> {
  const body = searchableBody({ role, content } as StoredMessage)
  if (body.length < MIN_INDEXED_CHARS) return
  try {
    const db = await getHiveDb()
    await db.upsertDoc({
      id: docId(threadId, seq),
      body,
      filters: [
        { field: "type", value: TYPE },
        { field: "mthread", value: threadId },
      ],
    })
  } catch (err) {
    log.warn(`[message-memory] No se pudo indexar el mensaje ${seq} de ${threadId}: ${(err as Error).message}`)
  }
}

/** Quita del índice todos los mensajes de un hilo (al borrar la conversación). */
export async function removeThreadMessages(threadId: string): Promise<void> {
  try {
    const db = await getHiveDb()
    await db.deleteByFilter({ field: "mthread", value: threadId })
  } catch (err) {
    log.warn(`[message-memory] No se pudieron quitar los mensajes de ${threadId}: ${(err as Error).message}`)
  }
}

/**
 * Los mensajes de `threadId` más cercanos a `query`, del más relevante al
 * menos. Vacío si el índice falla o no hay nada: quien llama cae a otra vía.
 */
export async function searchThreadMessages(
  threadId: string,
  query: string,
  k = DEFAULT_K,
): Promise<MessageHit[]> {
  const text = query.trim().slice(0, QUERY_MAX_CHARS)
  if (!text || k <= 0) return []
  try {
    const db = await getHiveDb()
    const hits = await db.queryHybrid({
      text,
      k,
      filters: [
        { field: "type", value: TYPE },
        { field: "mthread", value: threadId },
      ],
    })
    const prefix = `${TYPE}:${threadId}:`
    const scored = new Map<number, number>()
    for (const hit of hits) {
      const id = hit.id
      if (!id.startsWith(prefix)) continue
      const seq = parseInt(id.slice(prefix.length), 10)
      if (Number.isFinite(seq)) scored.set(seq, hit.score)
    }
    if (scored.size === 0) return []
    // El índice solo devuelve ids: el texto vive en `conversations`. Un id cuyo
    // mensaje ya no existe quedó huérfano y se descarta aquí.
    const rows = await getMessagesByIds(threadId, [...scored.keys()])
    return rows
      .map((message) => ({ message, score: scored.get(message.id) ?? 0 }))
      .sort((a, b) => b.score - a.score)
  } catch (err) {
    log.warn(`[message-memory] Búsqueda de mensajes de ${threadId} falló: ${(err as Error).message}`)
    return []
  }
}
