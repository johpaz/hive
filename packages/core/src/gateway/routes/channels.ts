import { getDb } from "../../storage/sqlite"
import { encryptConfig, decryptConfig } from "../../storage/crypto"

export async function handleGetChannels(req: Request, addCorsHeaders: (r: Response, req: Request) => Response): Promise<Response> {
  const channels = getDb().query(`
    SELECT id, type, id as account_id, enabled, active, status, last_active, voice_enabled, tts_enabled, stt_provider, tts_provider, tts_voice_id, step_delivery_mode,
           (config_encrypted IS NOT NULL) as is_configured
    FROM channels
  `).all() as Array<{
    id: string;
    type: string;
    account_id: string;
    enabled: number;
    active: number;
    status: string;
    last_active: number | null;
    voice_enabled: number;
    tts_enabled: number;
    stt_provider: string | null;
    tts_provider: string | null;
    tts_voice_id: string | null;
    step_delivery_mode: string | null;
    is_configured: number;
  }>

  // Convert to format expected by UI (ConnectedChannel[])
  const formattedChannels = channels.map(c => ({
    id: c.id,
    type: c.type as ConnectedChannel["type"],
    accountId: c.account_id,
    enabled: c.enabled === 1,
    active: c.active === 1,
    status: c.status as ConnectedChannel["status"],
    last_active: c.last_active ?? undefined,
    voice_enabled: c.voice_enabled === 1,
    tts_enabled: c.tts_enabled === 1,
    stt_provider: c.stt_provider ?? undefined,
    tts_provider: c.tts_provider ?? undefined,
    tts_voice_id: c.tts_voice_id ?? undefined,
    step_delivery_mode: c.step_delivery_mode ?? undefined,
    isConfigured: c.is_configured === 1,
  }))

  return addCorsHeaders(Response.json({ channels: formattedChannels }), req)
}

type ConnectedChannel = {
  id: string;
  type: string;
  accountId?: string;
  enabled: boolean;
  active: boolean;
  status: string;
  last_active?: number;
  voice_enabled: boolean;
  tts_enabled: boolean;
  stt_provider?: string;
  tts_provider?: string;
  tts_voice_id?: string;
  step_delivery_mode?: string;
  isConfigured?: boolean;
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
  const { type, config: channelConfig } = body;

  if (!type) {
    return addCorsHeaders(new Response("Missing type", { status: 400 }), req);
  }

  const { randomUUID } = await import("crypto");
  const id = randomUUID();

  let encryptedData: string | null = null;
  let configIv: string | null = null;
  if (channelConfig && Object.keys(channelConfig).length > 0) {
    const { encrypted, iv } = encryptConfig(channelConfig);
    encryptedData = encrypted;
    configIv = iv;
  }

  getDb().query(`
    INSERT INTO channels(id, type, config_encrypted, config_iv, enabled, active, status)
    VALUES(?, ?, ?, ?, 1, 1, 'connecting')
  `).run(id, type, encryptedData, configIv);

  if (channelManager) {
    channelManager.addChannel(type, id, channelConfig || {}).catch((err: Error) => {
      console.error(`[channels] Failed to start ${type}:${id}:`, err.message);
    });
  }

  return addCorsHeaders(Response.json({ success: true, id, status: "connecting" }), req);
}

export async function handleReconnectChannel(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelId: string,
  channelManager?: any
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { config: newConfig } = body;

  const row = getDb().query(`SELECT type, config_encrypted, config_iv FROM channels WHERE id = ?`).get(channelId) as {
    type: string;
    config_encrypted: string | null;
    config_iv: string | null;
  } | undefined;

  if (!row) {
    return addCorsHeaders(Response.json({ success: false, error: "Channel not found" }, { status: 404 }), req);
  }

  // Update credentials if new config provided
  if (newConfig && Object.keys(newConfig).length > 0) {
    const { encrypted, iv } = encryptConfig(newConfig);
    getDb().query(`UPDATE channels SET config_encrypted = ?, config_iv = ?, active = 1, status = 'connecting' WHERE id = ?`)
      .run(encrypted, iv, channelId);
  } else {
    getDb().query(`UPDATE channels SET active = 1, status = 'connecting' WHERE id = ?`)
      .run(channelId);
  }

  if (channelManager) {
    // Resolve config: use new or existing encrypted config
    let config: Record<string, unknown> = {};
    if (newConfig && Object.keys(newConfig).length > 0) {
      config = newConfig;
    } else if (row.config_encrypted && row.config_iv) {
      try {
        config = decryptConfig(row.config_encrypted, row.config_iv);
      } catch { /* keep empty */ }
    }

    // Remove old instance and start fresh
    channelManager.removeChannel(row.type, channelId).catch(() => {});
    channelManager.addChannel(row.type, channelId, config).catch((err: Error) => {
      console.error(`[channels] Failed to reconnect ${row.type}:${channelId}:`, err.message);
    });
  }

  return addCorsHeaders(Response.json({ success: true, status: "connecting" }), req);
}

export async function handleGetChannelStatus(
  req: Request,
  addCorsHeaders: (r: Response, req: Request) => Response,
  channelManager?: any
): Promise<Response> {
  const url = new URL(req.url);
  const match = url.pathname.match(/^\/api\/channels\/([^/]+)\/([^/]+)\/status$/);
  if (!match) {
    return addCorsHeaders(Response.json({ error: "Invalid path" }, { status: 400 }), req);
  }

  const [, type, id] = match;

  if (!channelManager) {
    return addCorsHeaders(Response.json({ status: "unknown" }), req);
  }

  const statusData = channelManager.getChannelStatus(type, id);
  return addCorsHeaders(Response.json(statusData), req);
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
