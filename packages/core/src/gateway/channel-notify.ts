/**
 * channel-notify — singleton para que tools envíen mensajes al canal activo del usuario.
 *
 * Se inicializa en server.ts con el channelManager real.
 * Las tools (notify, report_progress) lo importan directamente.
 */

import { logger } from "../utils/logger"
import { col } from "../storage/hive"
import type { UserIdentityDoc } from "../storage/collections"
import {
  createNotification,
  markNotificationDelivered,
} from "./notification-inbox"

const log = logger.child("channel-notify")

type SendFn = (
  channel: string,
  sessionId: string,
  message: string,
  metadata?: { notificationId?: string; accountId?: string },
) => Promise<void>

let _sendFn: SendFn | null = null

/** Llamar en server.ts una vez que channelManager esté listo */
export function setChannelSendFn(fn: SendFn): void {
  _sendFn = fn
  log.info("[channel-notify] Send function registered")
}

/**
 * Resuelve el sessionId real (chat ID de Telegram, etc.) desde user_identities,
 * junto con la cuenta del canal por la que llegó — con varias cuentas del mismo
 * tipo conectadas, la respuesta debe salir por la misma.
 * Necesario porque config.thread_id es el userId interno, no el chat ID externo.
 */
async function resolveSession(userId: string, channel: string): Promise<{ sessionId: string; accountId?: string }> {
  try {
    const identitiesCol = await col<UserIdentityDoc>("userIdentities")
    const identity = await identitiesCol.get(`${userId}:${channel}`)
    if (identity?.doc.channel_user_id) {
      return { sessionId: identity.doc.channel_user_id, accountId: identity.doc.account_id }
    }
  } catch {
    // DB no lista — fallback al userId
  }
  return { sessionId: userId }
}

/**
 * Envía un mensaje al canal activo del usuario.
 * Usado por las tools notify y report_progress.
 */
export async function sendToUserChannel(
  channel: string,
  userId: string,
  message: string
): Promise<{ ok: boolean; queued?: boolean; notificationId?: string; error?: string }> {
  let notificationId: string | undefined
  if (channel === "webchat") {
    try {
      const notification = await createNotification({ userId, channel, message })
      notificationId = notification.id
    } catch (err) {
      const error = `Could not persist WebChat notification: ${(err as Error).message}`
      log.warn(`[channel-notify] ${error}`)
      return { ok: false, error }
    }
  }

  if (!_sendFn) {
    if (notificationId) {
      log.info(`[channel-notify] WebChat offline — notification ${notificationId} queued`)
      return { ok: true, queued: true, notificationId }
    }
    log.warn("[channel-notify] No send function registered")
    return { ok: false, error: "Channel send not initialized" }
  }

  const { sessionId, accountId } = await resolveSession(userId, channel)
  log.info(`[channel-notify] Sending to ${channel}/${sessionId}: ${message.substring(0, 80)}`)

  try {
    await _sendFn(channel, sessionId, message, { notificationId, accountId })
    if (notificationId) await markNotificationDelivered(notificationId, userId)
    return { ok: true, queued: false, notificationId }
  } catch (err) {
    log.warn(`[channel-notify] Failed to send: ${(err as Error).message}`)
    if (notificationId) {
      return { ok: true, queued: true, notificationId }
    }
    return { ok: false, error: (err as Error).message }
  }
}
