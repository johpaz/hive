/**
 * channel-notify — singleton para que tools envíen mensajes al canal activo del usuario.
 *
 * Se inicializa en server.ts con el channelManager real.
 * Las tools (notify, report_progress) lo importan directamente.
 */

import { logger } from "../utils/logger"
import { getDb } from "../storage/sqlite"

const log = logger.child("channel-notify")

type SendFn = (channel: string, sessionId: string, message: string) => Promise<void>

let _sendFn: SendFn | null = null

/** Llamar en server.ts una vez que channelManager esté listo */
export function setChannelSendFn(fn: SendFn): void {
  _sendFn = fn
  log.info("[channel-notify] Send function registered")
}

/**
 * Resuelve el sessionId real (chat ID de Telegram, etc.) desde user_identities.
 * Necesario porque config.thread_id es el userId interno, no el chat ID externo.
 */
function resolveSessionId(userId: string, channel: string): string {
  try {
    const db = getDb()
    const identity = db.query<{ channel_user_id: string }, [string, string]>(
      "SELECT channel_user_id FROM user_identities WHERE user_id = ? AND channel = ? LIMIT 1"
    ).get(userId, channel)
    if (identity?.channel_user_id) return identity.channel_user_id
  } catch {
    // DB no lista — fallback al userId
  }
  return userId
}

/**
 * Envía un mensaje al canal activo del usuario.
 * Usado por las tools notify y report_progress.
 */
export async function sendToUserChannel(
  channel: string,
  userId: string,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  if (!_sendFn) {
    log.warn("[channel-notify] No send function registered — message dropped")
    return { ok: false, error: "Channel send not initialized" }
  }

  const sessionId = resolveSessionId(userId, channel)
  log.info(`[channel-notify] Sending to ${channel}/${sessionId}: ${message.substring(0, 80)}`)

  try {
    await _sendFn(channel, sessionId, message)
    return { ok: true }
  } catch (err) {
    log.warn(`[channel-notify] Failed to send: ${(err as Error).message}`)
    return { ok: false, error: (err as Error).message }
  }
}
