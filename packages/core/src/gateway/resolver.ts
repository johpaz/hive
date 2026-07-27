import { col } from "../storage/hive"
import type { UserIdentityDoc, UserDoc, AgentDoc } from "../storage/collections"

export interface ResolveContextResult {
  userId: string
  threadId: string
  agentId: string
  isNewUser: boolean
}

export interface ResolveContextOptions {
  channel: string
  channelUserId: string
}

export async function resolveContext(options: ResolveContextOptions): Promise<ResolveContextResult> {
  const { channel, channelUserId } = options

  const identitiesCol = await col<UserIdentityDoc>("userIdentities")
  const usersCol = await col<UserDoc>("users")
  const agentsCol = await col<AgentDoc>("agents")

  const allIdentities = await identitiesCol.scan({})
  const identity = allIdentities.find(e => e.doc.channel === channel && e.doc.channel_user_id === channelUserId)

  let userId: string
  let isNewUser = false

  if (identity) {
    userId = identity.doc.user_id
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
      user_id: userId, channel, channel_user_id: channelUserId, linked_at: Date.now(),
    })
  }

  const coordinators = await agentsCol.findBy("role", "coordinator", { limit: 1 })
  const agentId = coordinators[0]?.id || "bee"
  // One canonical conversation thread is shared across channels. Transport
  // session IDs route replies; conversations.thread_id owns agent context.
  const threadId = userId

  return { userId, threadId, agentId, isNewUser }
}

