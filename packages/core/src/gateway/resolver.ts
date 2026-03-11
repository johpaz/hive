import { getDb } from "../storage/sqlite"

export interface ResolveContextResult {
  userId: string
  agentId: string
  isNewUser: boolean
}

export interface ResolveContextOptions {
  channel: string
  channelUserId: string
}

export function resolveContext(options: ResolveContextOptions): ResolveContextResult {
  const { channel, channelUserId } = options
  const db = getDb()

  const identity = db
    .query<any, [string, string]>(
      "SELECT user_id FROM user_identities WHERE channel = ? AND channel_user_id = ?"
    )
    .get(channel, channelUserId)

  let userId: string
  let isNewUser = false

  if (identity) {
    userId = identity.user_id
  } else {
    // Sistema mono-usuario: reutilizar el usuario del onboarding
    const existingUser = db
      .query<any, []>("SELECT id FROM users ORDER BY created_at ASC LIMIT 1")
      .get() as { id: string } | undefined

    if (!existingUser) {
      throw new Error("No user found in database. Please run the onboarding process first.")
    }

    userId = existingUser.id

    // Vincular este canal al usuario existente (auto-link en el primer mensaje)
    // INSERT OR REPLACE: si ya existe una fila (user_id, channel), actualiza channel_user_id
    // con el valor real del canal (e.g. chat ID numérico de Telegram).
    db.query(
      "INSERT OR REPLACE INTO user_identities (user_id, channel, channel_user_id, linked_at) VALUES (?, ?, ?, ?)"
    ).run(userId, channel, channelUserId, Math.floor(Date.now() / 1000))
  }

  const coordinatorAgent = db
    .query<any, []>("SELECT id FROM agents WHERE role = 'coordinator' LIMIT 1")
    .get()

  const agentId = coordinatorAgent?.id || "bee"

  return { userId, agentId, isNewUser }
}

export function getDefaultAgentId(): string {
  const db = getDb()
  const coordinatorAgent = db
    .query<any, []>("SELECT id FROM agents WHERE role = 'coordinator' LIMIT 1")
    .get()

  return coordinatorAgent?.id || "bee"
}

export function getUserById(userId: string): any {
  const db = getDb()
  return db.query<any, [string]>("SELECT * FROM users WHERE id = ?").get(userId)
}

export function updateUserProfile(userId: string, updates: {
  name?: string
  language?: string
  timezone?: string
  occupation?: string
  notes?: string
}): void {
  const db = getDb()
  const setClauses: string[] = []
  const values: any[] = []

  if (updates.name !== undefined) {
    setClauses.push("name = ?")
    values.push(updates.name)
  }
  if (updates.language !== undefined) {
    setClauses.push("language = ?")
    values.push(updates.language)
  }
  if (updates.timezone !== undefined) {
    setClauses.push("timezone = ?")
    values.push(updates.timezone)
  }
  if (updates.occupation !== undefined) {
    setClauses.push("occupation = ?")
    values.push(updates.occupation)
  }
  if (updates.notes !== undefined) {
    setClauses.push("notes = ?")
    values.push(updates.notes)
  }

  if (setClauses.length > 0) {
    values.push(userId)
    db.query(`UPDATE users SET ${setClauses.join(", ")} WHERE id = ?`).run(...values)
  }
}
