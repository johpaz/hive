import { getDb } from "../../storage/sqlite"

export async function handleGetChannels(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const channels = getDb().query(`
    SELECT channel, COUNT(*) as count FROM user_channels GROUP BY channel
  `).all() as Record<string, unknown>[]
  
  return addCorsHeaders(Response.json({ channels }), req)
}

export async function handleGetChannelConfig(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const channelIdMatch = url.pathname.match(/^\/api\/channels\/([^/]+)$/)
  
  if (!channelIdMatch) {
    return addCorsHeaders(Response.json({ error: "Invalid path" }), req)
  }
  
  const channelId = channelIdMatch[1]
  const config = getDb().query(`
    SELECT * FROM user_channels WHERE channel = ?
  `).all(channelId) as Record<string, unknown>[]
  
  return addCorsHeaders(Response.json({ config }), req)
}

export async function handleActivateChannel(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  const { channel, config, accountId } = body
  
  if (!channel) {
    return addCorsHeaders(Response.json({ success: false, error: "channel required" }), req)
  }
  
  const userId = "default"
  getDb().query(`
    INSERT OR REPLACE INTO user_channels(user_id, channel, account_id, config, active)
    VALUES(?, ?, ?, ?, 1)
  `).run(userId, channel, accountId || null, JSON.stringify(config || {}))
  
  return addCorsHeaders(Response.json({ success: true, channel }), req)
}

export async function handleDeactivateChannel(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const url = new URL(req.url)
  const parts = url.pathname.split("/")
  const channel = parts[3]
  const accountId = parts[4]

  if (!channel) {
    return addCorsHeaders(Response.json({ success: false, error: "channel required" }), req)
  }

  const userId = "default"
  if (accountId) {
    getDb().query(`DELETE FROM user_channels WHERE user_id = ? AND channel = ? AND account_id = ?`).run(userId, channel, accountId)
  } else {
    getDb().query(`DELETE FROM user_channels WHERE user_id = ? AND channel = ?`).run(userId, channel)
  }

  return addCorsHeaders(Response.json({ success: true }), req)
}

export async function handleCreateChannel(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelManager?: any
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { name, accountId, config: channelConfigData } = body;

  if (!name || !accountId || !channelConfigData) {
    return addCorsHeaders(new Response("Missing name, accountId or config", { status: 400 }), req);
  }

  // Note: Channel config persistence should be handled by the caller
  // The channelManager is passed to start the channel after config is saved
  if (channelManager) {
    await channelManager.removeChannel(name, accountId);
    await channelManager.startChannel(name, accountId);
  }

  return addCorsHeaders(Response.json({ success: true }), req);
}

export async function handleGetChannelAccount(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  name: string,
  accountId: string
): Promise<Response> {
  // This should read from the config file or database
  // For now, return a placeholder - the actual implementation depends on config storage
  return addCorsHeaders(Response.json({ name, accountId, config: {} }), req);
}

export async function handleUpdateChannelAccount(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  name: string,
  accountId: string,
  channelManager?: any
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  if (!body.config) {
    return new Response("Missing config", { status: 400 });
  }

  // Note: Channel config persistence should be handled by the caller
  if (channelManager) {
    await channelManager.removeChannel(name, accountId);
    await channelManager.startChannel(name, accountId);
  }

  return addCorsHeaders(Response.json({ success: true }), req);
}

export async function handleDeleteChannelAccount(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  name: string,
  accountId: string,
  config?: any,
  channelManager?: any
): Promise<Response> {
  // Note: Config update should be handled by the caller
  if (channelManager) {
    await channelManager.removeChannel(name, accountId);
  }

  return addCorsHeaders(Response.json({ success: true }), req);
}

export async function handleChannelAction(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  name: string,
  accountId: string,
  action: "start" | "stop",
  channelManager?: any
): Promise<Response> {
  try {
    if (!channelManager) {
      return addCorsHeaders(new Response("Channel manager not available", { status: 500 }), req);
    }

    if (action === "start") {
      await channelManager.startChannel(name, accountId);
    } else {
      await channelManager.stopChannel(name, accountId);
    }
    return addCorsHeaders(Response.json({ success: true }), req);
  } catch (error) {
    return addCorsHeaders(Response.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    ), req);
  }
}

export async function handleUpdateChannelSettings(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelId: string
): Promise<Response> {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const allowed = ["voice_enabled", "tts_enabled", "stt_provider", "tts_provider", "tts_voice_id", "step_delivery_mode"] as const;
  const updates: string[] = [];
  const params: unknown[] = [];

  for (const key of allowed) {
    if (key in body) {
      updates.push(`${key} = ?`);
      params.push(typeof body[key] === "boolean" ? (body[key] ? 1 : 0) : body[key]);
    }
  }

  if (updates.length === 0) {
    return addCorsHeaders(Response.json({ error: "No valid fields to update" }, { status: 400 }), req);
  }

  params.push(channelId);
  getDb().query(`UPDATE channels SET ${updates.join(", ")} WHERE id = ?`).run(...params as any[]);

  return addCorsHeaders(Response.json({ success: true }), req);
}

export async function handleToggleChannel(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelId: string
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { active } = body;

  if (active === undefined) {
    return addCorsHeaders(Response.json({ success: false, error: "Missing active field", message: "Falta el campo 'active'" }, { status: 400 }), req);
  }

  getDb().query(`UPDATE channels SET active = ?, enabled = ? WHERE id = ?`).run(active ? 1 : 0, active ? 1 : 0, channelId);

  return addCorsHeaders(Response.json({ success: true, active, message: active ? `Canal "${channelId}" activado` : `Canal "${channelId}" desactivado` }), req);
}
