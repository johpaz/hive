import { col } from "../storage/hive"
import type { UserIdentityDoc, UserDoc, AgentDoc } from "../storage/collections"
import { ensureThread, mostRecentWebThread, createWebConversation } from "../agent/thread-store"

export interface ResolveContextResult {
  userId: string
  threadId: string
  agentId: string
  isNewUser: boolean
}

export interface ResolveContextOptions {
  channel: string
  channelUserId: string
  /** Channel account the message arrived on — persisted so replies can be routed back to it. */
  accountId?: string
  /**
   * Conversación concreta dentro del canal: el contacto o grupo en mensajería, el id
   * de conversación en la web. Si falta, en los canales se usa `channelUserId` y en
   * la web la conversación más reciente (o una nueva, si no hay ninguna).
   */
  peerId?: string
  peerKind?: "direct" | "group"
}

export async function resolveContext(options: ResolveContextOptions): Promise<ResolveContextResult> {
  const { channel, channelUserId, accountId } = options

  const identitiesCol = await col<UserIdentityDoc>("userIdentities")
  const usersCol = await col<UserDoc>("users")
  const agentsCol = await col<AgentDoc>("agents")

  const allIdentities = await identitiesCol.scan({})
  const identity = allIdentities.find(e => e.doc.channel === channel && e.doc.channel_user_id === channelUserId)

  let userId: string
  let isNewUser = false

  if (identity) {
    userId = identity.doc.user_id
    // Backfill/refresh the owning account so replies survive a restart, when
    // the in-memory session→account map in ChannelManager is empty.
    if (accountId && identity.doc.account_id !== accountId) {
      await identitiesCol.put(identity.id, { ...identity.doc, account_id: accountId })
    }
  } else {
    // Sistema mono-usuario: reutilizar el usuario del onboarding
    const allUsers = await usersCol.scan({})
    const existingUser = [...allUsers].sort((a, b) => a.doc.created_at - b.doc.created_at)[0]

    if (!existingUser) {
      throw new Error("No user found in database. Please run the onboarding process first.")
    }

    userId = existingUser.id

    // Vincular este canal al usuario existente (auto-link en el primer mensaje)
    // put(): si ya existe una fila (user_id, channel), actualiza channel_user_id
    // con el valor real del canal (e.g. chat ID numérico de Telegram).
    await identitiesCol.put(`${userId}:${channel}`, {
      user_id: userId, channel, channel_user_id: channelUserId,
      account_id: accountId, linked_at: Date.now(),
    })
  }

  const coordinators = await agentsCol.findBy("role", "coordinator", { limit: 1 })
  const agentId = coordinators[0]?.id || "bee"

  // Un hilo por canal Y por contacto (`${user}/${canal}/${peer}` — ver
  // agent/thread-id.ts). Antes todos los canales compartían un único hilo
  // (`threadId = userId`), así que lo hablado por Telegram entraba en el mismo
  // contexto que la web y un grupo de WhatsApp escribía en el chat privado del
  // dueño. Los session IDs de transporte siguen enrutando las respuestas.
  const threadId = options.peerId
    ? await ensureThread({
        userId,
        channel,
        peerId: options.peerId,
        peerKind: options.peerKind,
      })
    : channel === "webchat"
      // Sin conversación indicada, la web sigue donde se quedó: la más reciente
      // —que puede ser el hilo previo a la separación por canal— o una nueva.
      ? ((await mostRecentWebThread(userId))?.id ?? (await createWebConversation(userId)).id)
      : await ensureThread({
          userId,
          channel,
          peerId: channelUserId,
          peerKind: options.peerKind,
        })

  return { userId, threadId, agentId, isNewUser }
}
