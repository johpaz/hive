import { col, updateDoc } from "../../storage/hive"
import type { UserDoc, AgentDoc } from "../../storage/collections"

export async function handleGetUsers(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const usersCol = await col<UserDoc>("users")
  const agentsCol = await col<AgentDoc>("agents")
  const users = await usersCol.scan({})
  const agents = await agentsCol.scan({})

  const agentCountByUser = new Map<string, number>()
  for (const a of agents) {
    agentCountByUser.set(a.doc.user_id, (agentCountByUser.get(a.doc.user_id) || 0) + 1)
  }

  const sorted = [...users].sort((a, b) => b.doc.created_at - a.doc.created_at)

  return addCorsHeaders(Response.json({
    users: sorted.map(u => ({
      id: u.doc.id,
      name: u.doc.name,
      language: u.doc.language,
      timezone: u.doc.timezone,
      occupation: u.doc.occupation,
      notes: u.doc.notes,
      preferred_cron_channel: u.doc.preferred_cron_channel,
      createdAt: new Date(u.doc.created_at * 1000).toISOString(),
      agentCount: agentCountByUser.get(u.doc.id) || 0,
    }))
  }), req)
}

export async function handleCreateUser(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const usersCol = await col<UserDoc>("users")

  const id = crypto.randomUUID().replace(/-/g, "")
  await usersCol.put(id, {
    id,
    name: body.name || "User",
    language: body.language || "es",
    timezone: body.timezone || "UTC",
    occupation: body.occupation || "",
    notes: body.notes || "",
    master_key_hash: null,
    email: null,
    password_hash: null,
    preferred_cron_channel: "auto",
    created_at: Date.now(),
  })

  return addCorsHeaders(Response.json({
    ok: true,
    userId: id
  }), req)
}

export async function handleUpdateUserSettings(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const userId = url.searchParams.get("userId") || "default"
  const body = await req.json().catch(() => ({}))

  const patch: Partial<UserDoc> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.language !== undefined) patch.language = body.language
  if (body.timezone !== undefined) patch.timezone = body.timezone
  if (body.occupation !== undefined) patch.occupation = body.occupation
  if (body.notes !== undefined) patch.notes = body.notes
  if (body.preferred_cron_channel !== undefined) patch.preferred_cron_channel = body.preferred_cron_channel

  if (Object.keys(patch).length > 0) {
    await updateDoc<UserDoc>("users", userId, patch).catch(() => { /* user not found — no-op, matches prior UPDATE...WHERE semantics */ })
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
