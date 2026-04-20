import { getDb } from "../../storage/sqlite"

export async function handleGetUsers(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const users = getDb().query(`
    SELECT u.*, COUNT(DISTINCT a.id) as agent_count
    FROM users u
    LEFT JOIN agents a ON u.id = a.user_id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all() as Record<string, unknown>[]
  
  return addCorsHeaders(Response.json({
    users: users.map(u => ({
      id: u.id,
      name: u.name,
      language: u.language,
      timezone: u.timezone,
      occupation: u.occupation,
      notes: u.notes,
      createdAt: new Date((u.created_at as number) * 1000).toISOString(),
      agentCount: u.agent_count,
    }))
  }), req)
}

export async function handleCreateUser(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  
  const result = getDb().query(`
    INSERT INTO users(name, language, timezone, occupation, notes)
    VALUES(?, ?, ?, ?, ?)
    RETURNING id
  `).get(
    body.name || "User",
    body.language || "es",
    body.timezone || "UTC",
    body.occupation || "",
    body.notes || ""
  ) as { id: string } | undefined
  
  return addCorsHeaders(Response.json({
    ok: true,
    userId: result?.id
  }), req)
}

export async function handleUpdateUserSettings(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const userId = url.searchParams.get("userId") || "default"
  const body = await req.json().catch(() => ({}))

  const updates: string[] = []
  const params: unknown[] = []

  if (body.name !== undefined) {
    updates.push("name = ?")
    params.push(body.name)
  }
  if (body.language !== undefined) {
    updates.push("language = ?")
    params.push(body.language)
  }
  if (body.timezone !== undefined) {
    updates.push("timezone = ?")
    params.push(body.timezone)
  }
  if (body.occupation !== undefined) {
    updates.push("occupation = ?")
    params.push(body.occupation)
  }
  if (body.notes !== undefined) {
    updates.push("notes = ?")
    params.push(body.notes)
  }
  if (body.preferred_cron_channel !== undefined) {
    updates.push("preferred_cron_channel = ?")
    params.push(body.preferred_cron_channel)
  }

  if (updates.length > 0) {
    params.push(userId)
    getDb().query(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params as any[])
  }

  return addCorsHeaders(Response.json({ ok: true }), req)
}

export async function handleGetUserChannels(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  config?: any
): Promise<Response> {
  return addCorsHeaders(Response.json({
    user: config?.user || { id: "", name: "User", channels: {} },
  }), req);
}

export async function handleLinkUserChannel(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  config?: any,
  logger?: any
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { channel, channelUserId } = body;

  if (!channel || !channelUserId) {
    return addCorsHeaders(Response.json({ success: false, error: "Missing channel or channelUserId" }, { status: 400 }), req);
  }

  if (config) {
    config.user = config.user || { id: "", name: "User" };
    config.user.channels = config.user.channels || {};
    config.user.channels[channel] = channelUserId;

    if (logger) {
      logger.info(`Linked channel ${channel} to user ID ${channelUserId}`);
    }
  }

  return addCorsHeaders(Response.json({ success: true, channels: config?.user?.channels }), req);
}
