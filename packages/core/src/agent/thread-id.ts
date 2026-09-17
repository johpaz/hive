/**
 * Thread identity — `${userId}/${channel}/${peerId}`.
 *
 * Un hilo por canal Y por contacto: el chat privado de Telegram, cada grupo de
 * WhatsApp y cada conversación de la web tienen historial propio. Antes había un
 * único hilo por usuario (`threadId = userId`) compartido por todos los canales.
 *
 * Dos reglas de formato que no son cosméticas:
 *
 * 1. El separador es "/" y NO ":". Los mensajes viven en `conversations` con id
 *    `${threadId}:${seq}` y se leen por prefijo (`scan({ prefix: "${threadId}:" })`),
 *    sin índice secundario. El hilo legacy (id = userId pelado) se lee con prefijo
 *    `${userId}:`; si los hilos nuevos fueran `${userId}:webchat:...` ese scan se los
 *    tragaría enteros. Con "/" el historial viejo queda aislado sin migrar una fila.
 *
 * 2. Ningún segmento puede contener ":" — se sustituye por "_". Sin esto los peerIds
 *    compuestos rompen el aislamiento por prefijo: el DM de Telegram `12345` y el grupo
 *    `12345:678` (telegram.ts arma así el peerId de grupo) producirían los prefijos
 *    `.../12345:` y `.../12345:678:`, y el primero es prefijo del segundo — el DM leería
 *    los mensajes del grupo. Colapsar ":" hace que `${threadId}:` sea siempre un
 *    separador inequívoco, y mantiene válido el `lastIndexOf(":")` con que
 *    conversation-store extrae el número de secuencia.
 */

export const THREAD_SEP = "/"

/** Canal sintético de las tareas programadas: un hilo estable por cron job. */
export const CRON_CHANNEL = "cron"

export interface ThreadParts {
  userId: string
  channel: string
  peerId: string
}

/**
 * Deja un segmento apto para formar parte de un threadId: sin "/" (rompería el
 * parseo) y sin ":" (rompería el aislamiento por prefijo — ver cabecera).
 */
export function sanitizeSegment(value: string): string {
  return value.replace(/[/:]/g, "_").trim()
}

export function makeThreadId(userId: string, channel: string, peerId: string): string {
  const parts = [userId, channel, peerId].map((p) => sanitizeSegment(p || "") || "default")
  return parts.join(THREAD_SEP)
}

/**
 * Descompone un threadId con formato. Devuelve null para todo lo que no lo tenga:
 * el hilo legacy (`userId` pelado), los hilos aislados de los workers
 * (`task-<id>-<agente>`) y cualquier id heredado. Quien llame debe conservar su
 * comportamiento anterior ante un null, nunca inventar partes.
 */
export function parseThreadId(threadId: string): ThreadParts | null {
  if (!threadId) return null
  const parts = threadId.split(THREAD_SEP)
  if (parts.length !== 3) return null
  const [userId, channel, peerId] = parts
  if (!userId || !channel || !peerId) return null
  return { userId, channel, peerId }
}

export function isStructuredThreadId(threadId: string): boolean {
  return parseThreadId(threadId) !== null
}

/** Id de una conversación nueva de la web. No lo elige el cliente. */
export function newWebConversationId(): string {
  return `conv-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`
}
